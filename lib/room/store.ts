/**
 * The one thing the room service needs from the world outside it.
 *
 * Two implementations exist. `memory-store.ts` runs the whole test suite with no network,
 * and `redis-store.ts` is what actually runs. The service does not know which it has, so
 * every rule in it is tested against the fast one and then re-tested against the real one
 * without changing a line of the service.
 *
 * There is no publish or subscribe here. Rooms are polled, so a change is found by asking
 * rather than by being told, and there is no long-lived process for a message to be
 * delivered to. `MULTIPLAYER.md` records why the transport ended up that way.
 */

import type { Presence, Room, Seat, SeatMap } from "./protocol.ts";

export type CreateOutcome = "created" | "exists" | "full";

export interface RoomStore {
  /**
   * Writes the room only if the key is free and the cap has room.
   *
   * Both checks belong here rather than in the service, because both have to happen in the
   * same atomic step as the write. A service that counted rooms, found four, and then
   * wrote would let two simultaneous creates make a sixth room.
   */
  create(room: Room, cap: number): Promise<CreateOutcome>;

  get(key: string): Promise<Room | null>;

  /**
   * Writes only if the stored version still matches `expectedVersion`.
   *
   * This is the whole concurrency story. Two clients acting on one room both read version
   * 7, both build version 8, and exactly one swap succeeds. The loser is told it is stale
   * and re-reads rather than overwriting a move that already happened.
   */
  swap(next: Room, expectedVersion: number): Promise<boolean>;

  remove(key: string): Promise<void>;

  /** Rooms that have not expired. The cap is enforced against this. */
  activeCount(now: number): Promise<number>;

  /**
   * Pushes a room's expiry back without touching the room itself.
   *
   * Deliberately not a `swap`. A lease is not a change to the game, so it must not move the
   * version: every client is holding that number to send its next move against, and bumping
   * it because somebody's tab is still open would refuse a move that was never stale.
   */
  extend(key: string, expiresAt: number): Promise<void>;

  /**
   * Counts one hit against a named bucket and returns the running total for the window.
   *
   * Here rather than in a module-level map because there is no single process to keep one
   * in. Every request may land on a different instance, and a limit each instance counts
   * separately is a limit multiplied by however many are running.
   */
  hits(bucket: string, windowMs: number): Promise<number>;

  /** Records that a seat was seen. Called on connect and on every heartbeat. */
  touch(key: string, seat: Seat, now: number): Promise<void>;

  presence(key: string, now: number): Promise<SeatMap<Presence>>;

  close(): Promise<void>;
}
