/**
 * A `RoomStore` held in one process, for tests.
 *
 * Every rule the service enforces is verified against this before any network is involved,
 * so a failing test means the rule is wrong rather than that Redis was slow. The Redis
 * store then runs the same suite.
 *
 * `structuredClone` on the way in and the way out is not defensive tidiness. The real store
 * serialises through JSON, so a caller there can never hold a reference to stored state.
 * Handing out a live object here would let a test pass on a mutation that cannot work in
 * production.
 */

import { presenceOf } from "./presence.ts";
import type { Presence, Room, Seat, SeatMap } from "./protocol.ts";
import type { CreateOutcome, RoomStore } from "./store.ts";

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Room>();
  private seen = new Map<string, number>();

  /** Set by a test to make a swap lose a race it would otherwise win. */
  onBeforeSwap: (() => void | Promise<void>) | null = null;

  private live(now: number): Room[] {
    return [...this.rooms.values()].filter((r) => r.expiresAt > now);
  }

  async create(room: Room, cap: number): Promise<CreateOutcome> {
    const existing = this.rooms.get(room.key);
    if (existing !== undefined && existing.expiresAt > room.createdAt) return "exists";
    if (this.live(room.createdAt).length >= cap) return "full";
    this.rooms.set(room.key, structuredClone(room));
    return "created";
  }

  async get(key: string): Promise<Room | null> {
    const room = this.rooms.get(key);
    return room === undefined ? null : structuredClone(room);
  }

  async swap(next: Room, expectedVersion: number): Promise<boolean> {
    await this.onBeforeSwap?.();
    const current = this.rooms.get(next.key);
    if (current === undefined) return false;
    if (current.version !== expectedVersion) return false;
    this.rooms.set(next.key, structuredClone(next));
    return true;
  }

  async remove(key: string): Promise<void> {
    this.rooms.delete(key);
    this.seen.delete(`${key}:white`);
    this.seen.delete(`${key}:black`);
  }

  async activeCount(now: number): Promise<number> {
    return this.live(now).length;
  }

  async touch(key: string, seat: Seat, now: number): Promise<void> {
    this.seen.set(`${key}:${seat}`, now);
  }

  async presence(key: string, now: number): Promise<SeatMap<Presence>> {
    return {
      white: presenceOf(this.seen.get(`${key}:white`) ?? null, now),
      black: presenceOf(this.seen.get(`${key}:black`) ?? null, now),
    };
  }

  async close(): Promise<void> {
    this.rooms.clear();
    this.seen.clear();
  }
}
