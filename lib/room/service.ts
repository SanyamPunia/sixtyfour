/**
 * Every rule a room has, with nothing underneath it that knows about sockets or Redis.
 *
 * The server is a thin shell over this file: it decodes a message, calls one function
 * here, and publishes the result. That split is what makes the interesting cases testable
 * without a network, and the interesting cases are all races.
 *
 * Nothing a client says is believed. A move arrives as two squares, and the only thing
 * that can turn it into a move is a lookup against what the position actually allows.
 */

import { startPosition } from "../chess/board.ts";
import { makeMove } from "../chess/make.ts";
import { fromUci } from "../chess/notation.ts";
import { gameStatus, isGameOver } from "../chess/rules.ts";
import type { Color, GameStatus, Position } from "../chess/types.ts";
import { BLACK, WHITE } from "../chess/types.ts";
import { generateKey, generateToken } from "./key.ts";
import type {
  Presence,
  RejectReason,
  Room,
  RoomSnapshot,
  Seat,
  SeatMap,
  SeatPreference,
} from "./protocol.ts";
import type { RoomStore } from "./store.ts";

/**
 * How many rooms may exist at once, anywhere.
 *
 * This is a hobby project on one small instance, and the cap is what stops a link on a
 * social site from turning into a bill. It is deliberately global rather than per user,
 * because there are no users to key it by.
 */
export const ROOM_CAP = 5;

/** Refreshed on every move, so a game in progress cannot expire underneath the players. */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

/** A swap can only lose to another writer, and the other writer has now finished. */
const SWAP_ATTEMPTS = 4;

export function seatColor(seat: Seat): Color {
  return seat === "white" ? WHITE : BLACK;
}

export function colorSeat(color: Color): Seat {
  return color === WHITE ? "white" : "black";
}

/**
 * The position a move list produces, or null if the list is not playable.
 *
 * Rebuilt from the start every time rather than cached. A game is a few dozen moves and
 * the engine runs at millions of nodes a second, so this is far below the cost of the
 * network round trip that asked for it. Storing a board next to the moves would be a
 * second copy of the truth, and the two can disagree.
 */
export function replay(
  moves: readonly string[],
): { position: Position; status: GameStatus } | null {
  const position = startPosition();
  for (const uci of moves) {
    const move = fromUci(position, uci);
    if (move === null) return null;
    makeMove(position, move);
  }
  return { position, status: gameStatus(position) };
}

/** The room with the seat secrets removed. This is the only shape a client ever sees. */
export function snapshot(room: Room, status: GameStatus): RoomSnapshot {
  return {
    key: room.key,
    version: room.version,
    moves: [...room.moves],
    taken: { white: room.seats.white !== null, black: room.seats.black !== null },
    status,
  };
}

function seatOfToken(room: Room, token: string): Seat | null {
  if (token !== "" && room.seats.white === token) return "white";
  if (token !== "" && room.seats.black === token) return "black";
  return null;
}

/**
 * Which seat this player can have, or null.
 *
 * A seat nobody has answered from in a while is available again. Without that, a player who
 * closed the tab is locked out of their own game: the token that proved the seat was theirs
 * lives in that tab and died with it, while the seat stays claimed for the room's full
 * lifetime. The room then reports itself full to the only two people entitled to be in it.
 *
 * Genuinely empty seats are taken first, so a second player joining a fresh room never
 * displaces the person who made it.
 */
function pickSeat(
  room: Room,
  prefer: SeatPreference,
  presence: SeatMap<Presence>,
): Seat | null {
  const empty: Seat[] = [];
  const abandoned: Seat[] = [];
  for (const seat of ["white", "black"] as const) {
    if (room.seats[seat] === null) empty.push(seat);
    else if (presence[seat] === "gone") abandoned.push(seat);
  }

  const free = empty.length > 0 ? empty : abandoned;
  if (free.length === 0) return null;
  if (prefer !== "random" && free.includes(prefer)) return prefer;
  return free[Math.floor(Math.random() * free.length)] as Seat;
}

export interface CreateSuccess {
  ok: true;
  room: Room;
  snapshot: RoomSnapshot;
  seat: Seat;
  token: string;
}

export type CreateResult = CreateSuccess | { ok: false; reason: "full" };

/**
 * Opens a room and seats the creator.
 *
 * The cap is checked by the store inside the same write, not here. Two people pressing
 * create at the same moment against four existing rooms would both count four and both
 * write, and the check would have proven nothing.
 */
export async function createRoom(
  store: RoomStore,
  options: { prefer?: SeatPreference; now: number },
): Promise<CreateResult> {
  const prefer = options.prefer ?? "random";
  const seat: Seat = prefer === "random" ? (Math.random() < 0.5 ? "white" : "black") : prefer;
  const token = generateToken();

  // A key collision is possible and astronomically unlikely, so it is worth handling and
  // not worth a loop that reads as though it happens.
  for (let attempt = 0; attempt < 3; attempt++) {
    const room: Room = {
      key: generateKey(),
      version: 0,
      moves: [],
      seats: { white: null, black: null, [seat]: token } as Room["seats"],
      createdAt: options.now,
      expiresAt: options.now + ROOM_TTL_MS,
    };
    const outcome = await store.create(room, ROOM_CAP);
    if (outcome === "full") return { ok: false, reason: "full" };
    if (outcome === "created") {
      // Taking a seat is itself proof of being here, and it is recorded where the seat is
      // granted rather than by the caller. A seat with no last-seen time is
      // indistinguishable from one that was abandoned, so forgetting this would make every
      // new seat immediately reclaimable by the next person with the link.
      await store.touch(room.key, seat, options.now);
      return { ok: true, room, snapshot: snapshot(room, "playing"), seat, token };
    }
  }
  return { ok: false, reason: "full" };
}

export interface JoinSuccess {
  ok: true;
  snapshot: RoomSnapshot;
  seat: Seat;
  token: string;
  /** False when an existing player came back, which is not something to announce. */
  fresh: boolean;
}

export type JoinResult =
  | JoinSuccess
  | { ok: false; reason: Extract<RejectReason, "not-found" | "full"> };

/**
 * Takes a seat, or takes back the one this player already had.
 *
 * A reload has to land back in the same seat rather than consume the other one, so a token
 * that already matches short-circuits everything below it. Without that, refreshing the
 * page in a two-player room fills it and locks the other player out of their own game.
 */
export async function joinRoom(
  store: RoomStore,
  options: { key: string; token?: string; prefer?: SeatPreference; now: number },
): Promise<JoinResult> {
  for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt++) {
    const room = await store.get(options.key);
    if (room === null || room.expiresAt <= options.now) {
      return { ok: false, reason: "not-found" };
    }

    const status = replay(room.moves)?.status ?? "playing";

    const held = options.token === undefined ? null : seatOfToken(room, options.token);
    if (held !== null) {
      await store.touch(options.key, held, options.now);
      return {
        ok: true,
        snapshot: snapshot(room, status),
        seat: held,
        token: options.token as string,
        fresh: false,
      };
    }

    const presence = await store.presence(options.key, options.now);
    const seat = pickSeat(room, options.prefer ?? "random", presence);
    if (seat === null) return { ok: false, reason: "full" };

    const token = generateToken();
    const next: Room = {
      ...room,
      version: room.version + 1,
      seats: { ...room.seats, [seat]: token },
    };
    // Two people opening the same link at the same second both see one free seat. The swap
    // is what makes exactly one of them get it, and the loser goes round again and is told
    // the room is full.
    if (await store.swap(next, room.version)) {
      await store.touch(options.key, seat, options.now);
      return { ok: true, snapshot: snapshot(next, status), seat, token, fresh: true };
    }
  }
  return { ok: false, reason: "full" };
}

export interface MoveSuccess {
  ok: true;
  snapshot: RoomSnapshot;
  uci: string;
  seat: Seat;
}

export interface MoveFailure {
  ok: false;
  reason: RejectReason;
  /** The authoritative room, so a client that guessed wrong can correct itself. */
  snapshot: RoomSnapshot | null;
}

export type MoveResult = MoveSuccess | MoveFailure;

/**
 * Validates a move and, if it holds up, writes it.
 *
 * Every check here is one a client could have run itself. They are run again because a
 * client is a thing anyone can rewrite, and the one on the other side of the room did not
 * agree to play against a rewritten one.
 */
export async function playMove(
  store: RoomStore,
  options: { key: string; token: string; uci: string; at: number; now: number },
): Promise<MoveResult> {
  const room = await store.get(options.key);
  if (room === null || room.expiresAt <= options.now) {
    return { ok: false, reason: "not-found", snapshot: null };
  }

  const seat = seatOfToken(room, options.token);
  if (seat === null) {
    return { ok: false, reason: "not-your-seat", snapshot: snapshot(room, "playing") };
  }

  const replayed = replay(room.moves);
  if (replayed === null) {
    return { ok: false, reason: "not-found", snapshot: null };
  }
  const { position, status } = replayed;
  const view = snapshot(room, status);

  // Checked before anything about the game itself, because every judgement below this is
  // about a board the sender could not see. A player who missed two moves is on their own
  // turn and holding a legal-looking move, and telling them it is not their turn would be
  // both false and unactionable. The one true answer is that they are behind.
  if (room.version !== options.at) {
    return { ok: false, reason: "stale", snapshot: view };
  }

  if (isGameOver(status)) return { ok: false, reason: "game-over", snapshot: view };
  if (position.side !== seatColor(seat)) {
    return { ok: false, reason: "not-your-turn", snapshot: view };
  }

  const move = fromUci(position, options.uci);
  if (move === null) return { ok: false, reason: "illegal", snapshot: view };

  makeMove(position, move);
  const next: Room = {
    ...room,
    version: room.version + 1,
    moves: [...room.moves, options.uci],
    expiresAt: options.now + ROOM_TTL_MS,
  };

  if (!(await store.swap(next, room.version))) {
    const fresh = await store.get(options.key);
    const freshStatus = fresh === null ? null : (replay(fresh.moves)?.status ?? "playing");
    return {
      ok: false,
      reason: "stale",
      snapshot: fresh === null || freshStatus === null ? null : snapshot(fresh, freshStatus),
    };
  }

  return {
    ok: true,
    snapshot: snapshot(next, gameStatus(position)),
    uci: options.uci,
    seat,
  };
}

/**
 * Clears the board for another game, keeping both seats.
 *
 * Only once the game is actually over. A rematch that could fire mid-game would be a
 * button either player can press to wipe a position they are losing.
 *
 * Seats do not swap. Swapping is the politer chess convention, but it would mean a player's
 * colour changing underneath them without the move that caused it, and the honest version
 * of that needs a message of its own.
 */
export async function rematch(
  store: RoomStore,
  options: { key: string; token: string; now: number },
): Promise<MoveResult> {
  const room = await store.get(options.key);
  if (room === null || room.expiresAt <= options.now) {
    return { ok: false, reason: "not-found", snapshot: null };
  }
  const seat = seatOfToken(room, options.token);
  if (seat === null) {
    return { ok: false, reason: "not-your-seat", snapshot: snapshot(room, "playing") };
  }

  const status = replay(room.moves)?.status ?? "playing";
  if (!isGameOver(status)) {
    return { ok: false, reason: "not-your-turn", snapshot: snapshot(room, status) };
  }

  const next: Room = {
    ...room,
    version: room.version + 1,
    moves: [],
    expiresAt: options.now + ROOM_TTL_MS,
  };
  if (!(await store.swap(next, room.version))) {
    return { ok: false, reason: "stale", snapshot: snapshot(room, status) };
  }
  return { ok: true, snapshot: snapshot(next, "playing"), uci: "", seat };
}

/**
 * Gives up a seat, and takes the room with it if that was the last one.
 *
 * Called when a player presses leave, and best-effort when a tab closes. Without it the
 * only thing that frees a seat is the abandonment window in `pickSeat`, so leaving and
 * coming straight back would report the room full for as long as that window lasts.
 *
 * Removing an empty room matters more than it looks. Rooms are capped globally, so one
 * abandoned game holds a fifth of the capacity until it expires a day later.
 */
export async function leaveRoom(
  store: RoomStore,
  options: { key: string; token: string; now: number },
): Promise<MoveResult> {
  for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt++) {
    const room = await store.get(options.key);
    if (room === null || room.expiresAt <= options.now) {
      return { ok: false, reason: "not-found", snapshot: null };
    }
    const seat = seatOfToken(room, options.token);
    if (seat === null) {
      // Not holding a seat here, so there is nothing to give up. Reported as success
      // because the caller's intent, to not be in this room, is already true.
      const status = replay(room.moves)?.status ?? "playing";
      return { ok: true, snapshot: snapshot(room, status), uci: "", seat: "white" };
    }

    const next: Room = {
      ...room,
      version: room.version + 1,
      seats: { ...room.seats, [seat]: null },
    };

    if (next.seats.white === null && next.seats.black === null) {
      await store.remove(options.key);
      return { ok: true, snapshot: snapshot(next, "playing"), uci: "", seat };
    }

    if (await store.swap(next, room.version)) {
      const status = replay(next.moves)?.status ?? "playing";
      return { ok: true, snapshot: snapshot(next, status), uci: "", seat };
    }
  }
  return { ok: false, reason: "stale", snapshot: null };
}
