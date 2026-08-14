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
  leaveRoom,
  playMove,
  rematch,
  replay,
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

export async function handleCreate(
  store: RoomStore,
  body: unknown,
  now: number,
): Promise<ApiResult> {
  const prefer = preference(body);
  const result = await createRoom(store, { now, ...(prefer === undefined ? {} : { prefer }) });
  if (!result.ok) return refuse(STATUS.full, "full");

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
