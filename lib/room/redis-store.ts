/**
 * The `RoomStore` that actually runs, backed by Redis.
 *
 * Two connections, because a subscribing connection cannot run commands. That is a
 * protocol rule rather than a client quirk: once a connection subscribes it will only
 * accept subscribe and unsubscribe until it stops.
 *
 * Everything that has to be atomic is a script. Redis runs a script to completion without
 * interleaving anything else, which is the only reason the compare-and-swap and the room
 * cap hold when two processes act at the same moment. A read followed by a write from the
 * client would not, however short the gap looks.
 *
 * The scripts avoid `cjson` and compare a version held in its own key instead. Decoding the
 * room inside Lua would work, but it makes the stored shape part of the script, and then a
 * field rename is a Redis migration rather than a TypeScript one.
 */

import Redis from "ioredis";
import { AWAY_MS, presenceOf } from "./presence.ts";
import type { Presence, Room, Seat, SeatMap, ServerMessage } from "./protocol.ts";
import type { CreateOutcome, RoomStore, Unsubscribe } from "./store.ts";

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

export interface RedisRoomStoreOptions {
  /**
   * Namespaces every key. Tests use one per run, so a contract suite can fill the room cap
   * and expire things without touching a real game.
   */
  prefix?: string;
}

export class RedisRoomStore implements RoomStore {
  private commands: Redis;
  private subscriber: Redis;
  private prefix: string;
  private handlers = new Map<string, Set<(message: ServerMessage) => void>>();

  constructor(url: string, options: RedisRoomStoreOptions = {}) {
    this.prefix = options.prefix ?? "sixtyfour:";
    this.commands = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    this.subscriber = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });

    this.subscriber.on("message", (channel: string, payload: string) => {
      const set = this.handlers.get(channel);
      if (set === undefined || set.size === 0) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(payload) as ServerMessage;
      } catch {
        // Something else is publishing on our channel. Dropping it is right: this process
        // cannot act on a message it cannot read, and throwing here would take down the
        // shared subscriber connection for every room in the process.
        return;
      }
      for (const handler of set) handler(message);
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

  private channel(key: string): string {
    return `${this.prefix}ch:${key}`;
  }

  async create(room: Room, cap: number): Promise<CreateOutcome> {
    const outcome = await this.commands.eval(
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
    const raw = await this.commands.get(this.roomKey(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as Room;
    } catch {
      return null;
    }
  }

  async swap(next: Room, expectedVersion: number): Promise<boolean> {
    const written = await this.commands.eval(
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
    await this.commands
      .multi()
      .del(this.roomKey(key), this.versionKey(key))
      .del(this.seenKey(key, "white"), this.seenKey(key, "black"))
      .zrem(this.indexKey(), key)
      .exec();
  }

  async activeCount(now: number): Promise<number> {
    await this.commands.zremrangebyscore(this.indexKey(), "-inf", now);
    return await this.commands.zcard(this.indexKey());
  }

  async touch(key: string, seat: Seat, now: number): Promise<void> {
    // The key's own lifetime is what turns a stopped heartbeat into "gone", so nothing has
    // to sweep it. `presenceOf` handles the window in between.
    await this.commands.set(this.seenKey(key, seat), String(now), "PX", AWAY_MS + 5_000);
  }

  async presence(key: string, now: number): Promise<SeatMap<Presence>> {
    const [white, black] = await this.commands.mget(
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

  async publish(key: string, message: ServerMessage): Promise<void> {
    await this.commands.publish(this.channel(key), JSON.stringify(message));
  }

  async subscribe(
    key: string,
    handler: (message: ServerMessage) => void,
  ): Promise<Unsubscribe> {
    const channel = this.channel(key);
    let set = this.handlers.get(channel);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(channel, set);
      // Only the first listener in this process costs a round trip. Two players in one
      // room on one instance share the one subscription.
      await this.subscriber.subscribe(channel);
    }
    set.add(handler);

    return async () => {
      const current = this.handlers.get(channel);
      if (current === undefined) return;
      current.delete(handler);
      if (current.size > 0) return;
      this.handlers.delete(channel);
      await this.subscriber.unsubscribe(channel);
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await Promise.all([this.commands.quit(), this.subscriber.quit()]);
  }

  /** Removes every key this prefix owns. Only ever called by a test tearing itself down. */
  async drop(): Promise<void> {
    const keys = await this.commands.keys(`${this.prefix}*`);
    if (keys.length > 0) await this.commands.del(...keys);
  }
}
