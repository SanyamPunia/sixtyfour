/**
 * Everything that crosses the socket, and the record behind it.
 *
 * The wire is the contract between two pieces of code that deploy separately, so the
 * client and the server can be running different builds at the same time. Every message
 * carries `protocol`, and a mismatch is refused rather than guessed at.
 *
 * No React and no Redis here. Both sides import this file.
 */

import type { GameStatus } from "../chess/types.ts";

export const PROTOCOL = 1;

export type Seat = "white" | "black";

export type SeatPreference = Seat | "random";

/** The seats a room has filled. */
export interface SeatMap<T> {
  white: T;
  black: T;
}

/**
 * The stored room.
 *
 * Only the moves are kept, not a board. Replaying six dozen moves through the engine costs
 * microseconds, and a stored board would be a second copy of the truth that can disagree
 * with the move list. Threefold repetition needs the whole history anyway.
 *
 * `seats` holds the two player secrets, so this record never goes to a client.
 */
export interface Room {
  key: string;
  /** Bumped on every accepted move. Drives the compare-and-swap and the client's resume. */
  version: number;
  moves: string[];
  seats: SeatMap<string | null>;
  createdAt: number;
  expiresAt: number;
}

/** The room as a client is allowed to see it. Carries no secrets. */
export interface RoomSnapshot {
  key: string;
  version: number;
  moves: string[];
  taken: SeatMap<boolean>;
  status: GameStatus;
}

/**
 * Three states, because two are a lie.
 *
 * A socket drops on every tab switch on mobile and on every brief network change, and
 * reporting that as "gone" makes the indicator flicker through a disconnection the player
 * never noticed. `away` is the grace window that absorbs it.
 */
export type Presence = "here" | "away" | "gone";

export interface Envelope {
  protocol: number;
}

export type ClientMessage =
  | (Envelope & { type: "create"; prefer?: SeatPreference })
  | (Envelope & { type: "join"; key: string; token?: string; prefer?: SeatPreference })
  | (Envelope & { type: "move"; key: string; token: string; uci: string; at: number })
  | (Envelope & { type: "rematch"; key: string; token: string })
  | (Envelope & { type: "ping"; key: string; token: string });

export type RejectReason =
  | "not-found"
  | "full"
  | "not-your-seat"
  | "not-your-turn"
  | "game-over"
  | "illegal"
  | "stale";

export type ServerMessage =
  | (Envelope & {
      type: "joined";
      seat: Seat;
      token: string;
      room: RoomSnapshot;
      presence: SeatMap<Presence>;
    })
  | (Envelope & { type: "moved"; uci: string; room: RoomSnapshot })
  | (Envelope & { type: "presence"; key: string; presence: SeatMap<Presence> })
  | (Envelope & { type: "rejected"; reason: RejectReason; room: RoomSnapshot | null })
  | (Envelope & { type: "error"; code: string; message: string });

export function opposite(seat: Seat): Seat {
  return seat === "white" ? "black" : "white";
}
