/**
 * The `RoomStore` that actually runs, backed by Redis over its native protocol.
 *
 * Everything that has to be atomic is a script. Redis runs a script to completion without
 * interleaving anything else, which is the only reason the compare-and-swap and the room
 * cap hold when two requests land at the same moment. A read followed by a write from the
 * caller would not, however short the gap looks, and on a serverless host there is no
 * single process to serialise them.
 *
 * The scripts avoid `cjson` and compare a version held in its own key instead. Decoding the
 * room inside Lua would work, but it makes the stored shape part of the script, and then a
 * field rename is a Redis migration rather than a TypeScript one.
 *
 * TCP rather than the REST API. Route handlers run on Node, so a socket to Redis is
 * available, and using it means the connection string already in the environment is the
 * only credential this needs.
 */

import Redis from "ioredis";
import { AWAY_MS, presenceOf } from "./presence.ts";
import type { Presence, Room, Seat, SeatMap } from "./protocol.ts";
import type { CreateOutcome, RoomStore } from "./store.ts";

/**
 * Creates only when the key is free and the cap has room.
 *
 * The expiry sweep runs first so a room that timed out an hour ago is not still holding a
 * slot. `ZREMRANGEBYSCORE` is cheap when there is nothing to remove.
 */
const CREATE = `
local now = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
if redis.call('EXISTS', KEYS[1]) == 1 then return 'exists' end
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[5]) then return 'full' end
redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'PXAT', ARGV[3])
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[6])
return 'created'
`;

/**
 * Writes only if the version key still reads what the caller last saw.
 *
 * A missing key makes `GET` return `false` in Lua, which never equals the string it is
 * compared against, so a room that expired mid-edit fails the swap rather than being
 * resurrected by it.
 */
const SWAP = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PXAT', ARGV[4])
redis.call('SET', KEYS[2], ARGV[3], 'PXAT', ARGV[4])
redis.call('ZADD', KEYS[3], ARGV[4], ARGV[5])
return 1
`;

/**
 * Pushes the lease back on all three keys that carry it.
 *
 * The room, its version, and the index entry the cap is counted from all have to agree, or
 * a room outlives the number that decides whether it is still occupying a slot.
 */
const EXTEND = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('PEXPIREAT', KEYS[1], ARGV[1])
redis.call('PEXPIREAT', KEYS[2], ARGV[1])
redis.call('ZADD', KEYS[3], ARGV[1], ARGV[2])
return 1
`;

/** A counter that starts its own clock, so a window cannot be reset by counting again. */
const HITS = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

export interface RedisRoomStoreOptions {
  /**
   * Namespaces every key. Tests use one per run, so a contract suite can fill the room cap
   * and expire things without touching a real game.
   */
  prefix?: string;
}

export class RedisRoomStore implements RoomStore {
  private redis: Redis;
  private prefix: string;

  constructor(url: string, options: RedisRoomStoreOptions = {}) {
    this.prefix = options.prefix ?? "sixtyfour:";
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      // A request that cannot reach Redis should fail and be retried by the next poll,
      // rather than hold a function open until the platform kills it.
      connectTimeout: 5_000,
      // Commands issued in the same tick go out in one round trip. A poll asks three
      // questions, and this makes that one trip instead of three.
      enableAutoPipelining: true,
    });
  }

  private roomKey(key: string): string {
    return `${this.prefix}room:${key}`;
  }

  private versionKey(key: string): string {
    return `${this.prefix}room:${key}:v`;
  }

  private indexKey(): string {
    return `${this.prefix}rooms`;
  }

  private seenKey(key: string, seat: Seat): string {
    return `${this.prefix}seen:${key}:${seat}`;
  }

  async create(room: Room, cap: number): Promise<CreateOutcome> {
    const outcome = await this.redis.eval(
      CREATE,
      3,
      this.roomKey(room.key),
      this.versionKey(room.key),
      this.indexKey(),
      JSON.stringify(room),
      String(room.version),
      String(room.expiresAt),
      String(room.createdAt),
      String(cap),
      room.key,
    );
    return outcome as CreateOutcome;
  }

  async get(key: string): Promise<Room | null> {
    const raw = await this.redis.get(this.roomKey(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as Room;
    } catch {
      return null;
    }
  }

  async swap(next: Room, expectedVersion: number): Promise<boolean> {
    const written = await this.redis.eval(
      SWAP,
      3,
      this.roomKey(next.key),
      this.versionKey(next.key),
      this.indexKey(),
      String(expectedVersion),
      JSON.stringify(next),
      String(next.version),
      String(next.expiresAt),
      next.key,
    );
    return written === 1;
  }

  async remove(key: string): Promise<void> {
    await this.redis
      .multi()
      .del(this.roomKey(key), this.versionKey(key))
      .del(this.seenKey(key, "white"), this.seenKey(key, "black"))
      .zrem(this.indexKey(), key)
      .exec();
  }

  async activeCount(now: number): Promise<number> {
    await this.redis.zremrangebyscore(this.indexKey(), "-inf", now);
    return await this.redis.zcard(this.indexKey());
  }

  async extend(key: string, expiresAt: number): Promise<void> {
    await this.redis.eval(
      EXTEND,
      3,
      this.roomKey(key),
      this.versionKey(key),
      this.indexKey(),
      String(expiresAt),
      key,
    );
  }

  async hits(bucket: string, windowMs: number): Promise<number> {
    const count = await this.redis.eval(
      HITS,
      1,
      `${this.prefix}hits:${bucket}`,
      String(windowMs),
    );
    return Number(count);
  }

  async touch(key: string, seat: Seat, now: number): Promise<void> {
    // The key's own lifetime is what turns a stopped heartbeat into "gone", so nothing has
    // to sweep it. `presenceOf` handles the window in between.
    await this.redis.set(this.seenKey(key, seat), String(now), "PX", AWAY_MS + 5_000);
  }

  async presence(key: string, now: number): Promise<SeatMap<Presence>> {
    const [white, black] = await this.redis.mget(
      this.seenKey(key, "white"),
      this.seenKey(key, "black"),
    );
    const read = (value: string | null | undefined): number | null => {
      if (value === null || value === undefined) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      white: presenceOf(read(white), now),
      black: presenceOf(read(black), now),
    };
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  /** Removes every key this prefix owns. Only ever called by a test tearing itself down. */
  async drop(): Promise<void> {
    const keys = await this.redis.keys(`${this.prefix}*`);
    if (keys.length > 0) await this.redis.del(...keys);
  }
}

/**
 * One store per running instance, built on first use.
 *
 * Route handlers are called, not started, so there is no place to construct this once and
 * hand it around. A module-level singleton is the equivalent: the instance is reused across
 * every request that lands on it, and so is its connection. Building a new client per
 * request would open a socket per request, which Redis notices long before we would.
 */
let shared: RedisRoomStore | null = null;

export function sharedRoomStore(): RedisRoomStore | null {
  const url = process.env.REDIS_URL ?? "";
  if (url === "") return null;
  if (shared === null) {
    // A prefix per deployment keeps preview builds and verification runs out of production's
    // five-room cap. They share one Redis, and without this a preview someone opened would
    // take a slot from a real game.
    const prefix = process.env.REDIS_PREFIX ?? "";
    shared = new RedisRoomStore(url, prefix === "" ? {} : { prefix });
  }
  return shared;
}
