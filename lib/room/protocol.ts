/**
 * Everything that crosses the network, and the record behind it.
 *
 * A browser holds a page for as long as it is open, so it can still be running a build the
 * server has replaced. Every response carries `protocol`, and a mismatch is reported rather
 * than guessed at.
 *
 * No React and no Redis here. The browser and the route handlers both import this file, and
 * that shared import is what stops the two from drifting.
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
 * Polling stops whenever a phone locks or a tab goes to the background, and reporting that
 * as "gone" makes the indicator flicker through an interruption neither player noticed.
 * `away` is the grace window that absorbs it.
 */
export type Presence = "here" | "away" | "gone";

/**
 * The three answers the API gives.
 *
 * `state` is what a poll returns and carries no secret. `joined` is the only response that
 * ever contains a token, and only to the browser that just earned it. `rejected` carries the
 * room back whenever there is one, because a browser that guessed wrong needs something
 * truthful to replace its board with.
 */
export interface JoinedBody {
  protocol: number;
  type: "joined";
  seat: Seat;
  token: string;
  room: RoomSnapshot;
  presence: SeatMap<Presence>;
}

export interface StateBody {
  protocol: number;
  type: "state";
  room: RoomSnapshot;
  presence: SeatMap<Presence>;
}

export type RejectReason =
  | "not-found"
  /** This room has both seats taken. */
  | "full"
  /** Every room slot is in use. Nothing to do with the room being asked for. */
  | "no-capacity"
  | "not-your-seat"
  | "not-your-turn"
  | "game-over"
  | "illegal"
  | "stale"
  | "unavailable";

export interface RejectedBody {
  protocol: number;
  type: "rejected";
  reason: RejectReason;
  room: RoomSnapshot | null;
}

export type ApiResponse = JoinedBody | StateBody | RejectedBody;

export function opposite(seat: Seat): Seat {
  return seat === "white" ? "black" : "white";
}
