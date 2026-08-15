/**
 * What each API route does, with no Next.js in sight.
 *
 * A route file under `app/api/` is four lines: read the body, call one function here, return
 * the result. Everything worth testing lives on this side of that line, so the whole API is
 * covered by `node --test` against an in-memory store with no server running at all.
 *
 * Nothing here decides a rule either. These functions parse an untrusted request, hand it to
 * `service.ts`, and shape the answer. The rules are in one place and both the tests and the
 * routes reach them the same way.
 */

import { isValidKey, normalizeKey } from "./key.ts";
import type {
  ApiResponse,
  RejectReason,
  RoomSnapshot,
  Seat,
  SeatPreference,
} from "./protocol.ts";
import { PROTOCOL } from "./protocol.ts";
import {
  createRoom,
  joinRoom,
  LEASE_REFRESH_MS,
  leaveRoom,
  playMove,
  ROOM_IDLE_MS,
  rematch,
  replay,
  resignRoom,
  snapshot,
} from "./service.ts";
import type { RoomStore } from "./store.ts";

export interface ApiResult {
  status: number;
  body: ApiResponse;
}

function refuse(
  status: number,
  reason: RejectReason,
  room: RoomSnapshot | null = null,
): ApiResult {
  return { status, body: { protocol: PROTOCOL, type: "rejected", reason, room } };
}

/** The status a refusal deserves, so a caller can act on the code alone. */
const STATUS: Record<RejectReason, number> = {
  "not-found": 404,
  full: 409,
  "no-capacity": 503,
  "not-your-seat": 403,
  "not-your-turn": 409,
  "game-over": 409,
  illegal: 422,
  stale: 409,
  unavailable: 503,
};

function text(body: unknown, name: string): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function number(body: unknown, name: string): number | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function preference(body: unknown): SeatPreference | undefined {
  const value = text(body, "prefer");
  return value === "white" || value === "black" || value === "random" ? value : undefined;
}

/**
 * A key from a URL, cleaned up, or null.
 *
 * Validated before it reaches Redis rather than after. A key is interpolated into a key
 * name, so anything that is not six characters of the room alphabet has no business
 * getting that far.
 */
export function readKey(raw: string): string | null {
  const key = normalizeKey(raw);
  return isValidKey(key) ? key : null;
}

/**
 * How many rooms one caller may open in an hour.
 *
 * The cap on rooms is what keeps this affordable, and that same cap is the only way the
 * feature can be taken away from everyone at once: five requests with no account behind
 * them held every slot. The idle window means those rooms now release themselves, and this
 * is what stops them being taken again the moment they do.
 *
 * Five is above anything a person does. Making a room, sharing it, and starting over
 * because the link went to the wrong chat is three.
 */
export const CREATES_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

export async function handleCreate(
  store: RoomStore,
  body: unknown,
  now: number,
  caller = "unknown",
): Promise<ApiResult> {
  // Counted before the room is made, so a refused create costs a caller their allowance
  // rather than a slot.
  const opened = await store.hits(`create:${caller}`, HOUR_MS);
  if (opened > CREATES_PER_HOUR) return refuse(429, "no-capacity");

  const prefer = preference(body);
  const result = await createRoom(store, { now, ...(prefer === undefined ? {} : { prefer }) });
  // Not `full`. Nothing is wrong with any particular room, there is simply no slot left,
  // and telling someone their room is full when they were trying to make one is a dead end.
  if (!result.ok) return refuse(STATUS["no-capacity"], "no-capacity");

  return {
    status: 201,
    body: {
      protocol: PROTOCOL,
      type: "joined",
      seat: result.seat,
      token: result.token,
      room: result.snapshot,
      presence: await store.presence(result.room.key, now),
    },
  };
}

export async function handleJoin(
  store: RoomStore,
  key: string,
  body: unknown,
  now: number,
): Promise<ApiResult> {
  const token = text(body, "token");
  const prefer = preference(body);
  const result = await joinRoom(store, {
    key,
    now,
    ...(token === undefined ? {} : { token }),
    ...(prefer === undefined ? {} : { prefer }),
  });
  if (!result.ok) return refuse(STATUS[result.reason], result.reason);

  return {
    status: 200,
    body: {
      protocol: PROTOCOL,
      type: "joined",
      seat: result.seat,
      token: result.token,
      room: result.snapshot,
      presence: await store.presence(key, now),
    },
  };
}

export async function handleMove(
  store: RoomStore,
  key: string,
  body: unknown,
  now: number,
): Promise<ApiResult> {
  const token = text(body, "token");
  const uci = text(body, "uci");
  const at = number(body, "at");
  if (token === undefined) return refuse(STATUS["not-your-seat"], "not-your-seat");
  if (uci === undefined || at === undefined) return refuse(STATUS.illegal, "illegal");

  const result = await playMove(store, { key, token, uci, at, now });
  if (!result.ok) return refuse(STATUS[result.reason], result.reason, result.snapshot);

  await store.touch(key, result.seat, now);
  return {
    status: 200,
    body: {
      protocol: PROTOCOL,
      type: "state",
      room: result.snapshot,
      presence: await store.presence(key, now),
    },
  };
}

export async function handleRematch(
  store: RoomStore,
  key: string,
  body: unknown,
  now: number,
): Promise<ApiResult> {
  const token = text(body, "token");
  if (token === undefined) return refuse(STATUS["not-your-seat"], "not-your-seat");

  const result = await rematch(store, { key, token, now });
  if (!result.ok) return refuse(STATUS[result.reason], result.reason, result.snapshot);

  return {
    status: 200,
    body: {
      protocol: PROTOCOL,
      type: "state",
      room: result.snapshot,
      presence: await store.presence(key, now),
    },
  };
}

/**
 * Gives up a seat.
 *
 * Reported as success when the token holds no seat here, because the caller wanted to not
 * be in this room and already is not. A leave that fails is worse than useless: it is
 * called from a tab that is closing and there is nobody left to retry it.
 */
export async function handleLeave(
  store: RoomStore,
  key: string,
  body: unknown,
  now: number,
): Promise<ApiResult> {
  const token = text(body, "token");
  if (token === undefined) return refuse(STATUS["not-your-seat"], "not-your-seat");

  const result = await leaveRoom(store, { key, token, now });
  if (!result.ok) return refuse(STATUS[result.reason], result.reason, result.snapshot);
  return {
    status: 200,
    body: {
      protocol: PROTOCOL,
      type: "state",
      room: result.snapshot,
      presence: await store.presence(key, now),
    },
  };
}

/**
 * Gives the game up.
 *
 * Takes a token like a move does, because it ends the game for both people and only the two
 * holding a seat may do that.
 */
export async function handleResign(
  store: RoomStore,
  key: string,
  body: unknown,
  now: number,
): Promise<ApiResult> {
  const token = text(body, "token");
  if (token === undefined) return refuse(STATUS["not-your-seat"], "not-your-seat");

  const result = await resignRoom(store, { key, token, now });
  if (!result.ok) return refuse(STATUS[result.reason], result.reason, result.snapshot);
  return {
    status: 200,
    body: {
      protocol: PROTOCOL,
      type: "state",
      room: result.snapshot,
      presence: await store.presence(key, now),
    },
  };
}

/**
 * The poll. Says we are still here, then says what changed.
 *
 * The seat comes from the caller and is only used to record presence, so claiming one you
 * do not hold buys nothing: it cannot move a piece and it cannot read anything a poll
 * without a seat would not also return. It is deliberately not the token, so that the one
 * request made over and over never carries the secret.
 */
export async function handlePoll(
  store: RoomStore,
  key: string,
  seat: string | null,
  now: number,
): Promise<ApiResult> {
  if (seat === "white" || seat === "black") {
    await store.touch(key, seat as Seat, now);
  }

  const room = await store.get(key);
  if (room === null || room.expiresAt <= now) return refuse(STATUS["not-found"], "not-found");

  /*
   * Somebody is looking at this room, so it is not idle.
   *
   * Only once the lease is over halfway gone, which turns a write on every poll into one
   * every quarter of an hour. It extends rather than swaps, so the version does not move:
   * a client is holding that number to send its next move against, and bumping it because
   * a tab is open would refuse a move that was never stale.
   */
  if (room.expiresAt - now < LEASE_REFRESH_MS) {
    await store.extend(key, now + ROOM_IDLE_MS);
  }

  const status = replay(room.moves)?.status ?? "playing";
  return {
    status: 200,
    body: {
      protocol: PROTOCOL,
      type: "state",
      room: snapshot(room, status),
      presence: await store.presence(key, now),
    },
  };
}
