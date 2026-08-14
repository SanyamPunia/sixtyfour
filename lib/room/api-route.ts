/**
 * The bit of every route file that is the same.
 *
 * Finds the store, guards the request, runs the handler, and turns the result into a
 * `Response`. What is left in a route file is which handler to call, which is the only part
 * that differs.
 *
 * This is the boundary between the framework and everything else. Nothing above it imports
 * Next, and nothing below it knows the request arrived over HTTP.
 */

import type { ApiResult } from "./handlers.ts";
import { PROTOCOL } from "./protocol.ts";
import { sharedRoomStore } from "./redis-store.ts";
import type { RoomStore } from "./store.ts";

/** A body larger than this is not one of these calls. */
const MAX_BODY = 4096;

function json(result: ApiResult): Response {
  return Response.json(result.body, {
    status: result.status,
    // Every one of these is about a room as it is right now. A cached answer is a wrong
    // answer, and a poll that gets one stops being a poll.
    headers: { "Cache-Control": "no-store" },
  });
}

function refused(status: number, reason: string): Response {
  return json({
    status,
    body: { protocol: PROTOCOL, type: "rejected", reason: reason as never, room: null },
  });
}

/**
 * Refuses a request that another site made on the user's behalf.
 *
 * These routes take no cookies and no session, so a forged request cannot borrow anyone's
 * identity, and a seat token is the only thing that authorises a move. That already makes
 * this hard to abuse. The check is here anyway because it costs one header read, and
 * because "there is nothing to steal" is a property of today's routes rather than a rule
 * anyone will remember when adding tomorrow's.
 */
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === null) return true;
  return site === "same-origin" || site === "none";
}

/**
 * Reads a JSON body, refusing anything oversized before it is in memory.
 *
 * The size is counted as the stream arrives and the read is abandoned the moment it goes
 * over. Reading the whole body first and measuring it afterwards is not a limit at all: by
 * the time the number is known the bytes have already been accepted, which is the one thing
 * the limit exists to prevent.
 *
 * `Content-Length` is checked first as a courtesy to honest clients, and is not trusted:
 * it is absent on a chunked body and can simply be a lie.
 *
 * The content type is required rather than sniffed. A cross-site `fetch` that sets it
 * triggers a preflight, which these routes do not answer, so insisting on it is a second
 * lock on the same door as the origin check.
 */
export async function readBody(request: Request): Promise<unknown | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY) return null;

  const body = request.body;
  if (body === null) return {};

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(merged);
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface RouteOptions {
  /** Omitted for a poll, which has no body. */
  request?: Request;
  run: (store: RoomStore, body: unknown, now: number) => Promise<ApiResult>;
}

export async function route(options: RouteOptions): Promise<Response> {
  const store = sharedRoomStore();
  if (store === null) {
    // No connection string configured. The rest of the product does not depend on this, so
    // the honest answer is that rooms are off rather than a crash.
    return refused(503, "unavailable");
  }

  let body: unknown = {};
  if (options.request !== undefined) {
    if (!sameOrigin(options.request)) return refused(403, "not-your-seat");
    const parsed = await readBody(options.request);
    if (parsed === null) return refused(415, "illegal");
    body = parsed;
  }

  try {
    return json(await options.run(store, body, Date.now()));
  } catch (error) {
    // A store that is briefly unreachable must not surface as a stack trace. The client
    // retries on its next poll, which is a second and a half away.
    console.error("[rooms] request failed", error);
    return refused(503, "unavailable");
  }
}
