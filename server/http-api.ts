/**
 * The same rooms over plain HTTP, for clients that cannot hold a socket open.
 *
 * A WebSocket upgrade is an unusual request, and some corporate proxies and captive
 * networks will not pass one. That client is not broken and should still get a game, so the
 * same service is exposed as four calls and a poll. It is worse in every way that matters,
 * which is why it is a fallback and not the transport: a move takes up to a poll interval
 * to appear, and presence is only as fresh as the last poll.
 *
 * Every route calls exactly the functions the socket path calls. There is no second copy of
 * any rule here, so the two transports cannot come to disagree about what is legal.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { PROTOCOL, type ServerMessage } from "../lib/room/protocol.ts";
import {
  createRoom,
  joinRoom,
  playMove,
  rematch,
  replay,
  snapshot,
} from "../lib/room/service.ts";
import type { RoomStore } from "../lib/room/store.ts";
import { originAllowed, RateLimiter } from "./guards.ts";

/** Bodies here are a few dozen bytes. Anything larger is not one of these calls. */
const MAX_BODY = 4096;

/** Per address rather than per connection, since polling brings a new one each time. */
const CALLS_PER_MINUTE = 240;

interface Deps {
  store: RoomStore;
  origins: readonly string[];
  now: () => number;
}

const limiters = new Map<string, RateLimiter>();

function limiterFor(address: string): RateLimiter {
  let limiter = limiters.get(address);
  if (limiter === undefined) {
    limiter = new RateLimiter(CALLS_PER_MINUTE, 60_000);
    // Bounded so a stream of addresses cannot grow this without limit. Dropping the oldest
    // costs an attacker nothing, but this is a backstop behind the socket path, not the
    // main door.
    if (limiters.size > 5_000) limiters.clear();
    limiters.set(address, limiter);
  }
  return limiter;
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("body is not json"));
      }
    });
    request.on("error", reject);
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function field(body: unknown, name: string): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Handles a room call, or reports that this was not one.
 *
 * Returning false rather than writing a 404 lets the caller keep owning its own routes,
 * so the health check and this share a server without either knowing the other's paths.
 */
export async function handleRoomHttp(
  request: IncomingMessage,
  response: ServerResponse,
  deps: Deps,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://placeholder");
  const parts = url.pathname.split("/").filter((p) => p !== "");
  if (parts[0] !== "rooms") return false;

  const origin = request.headers.origin;
  // The socket path gets this on the upgrade. Here it has to be checked per request, and
  // it has to be checked at all: a simple POST reaches the handler before any preflight
  // response could have stopped it.
  if (origin !== undefined && !originAllowed(origin, deps.origins)) {
    json(response, 403, { error: "origin" });
    return true;
  }
  if (origin !== undefined) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Vary", "Origin");
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return true;
  }

  const address = request.socket.remoteAddress ?? "unknown";
  if (!limiterFor(address).allow(deps.now())) {
    json(response, 429, { error: "rate" });
    return true;
  }

  const publish = async (key: string, message: ServerMessage): Promise<void> => {
    // Published even though the caller is polling, because the other player may well be on
    // a socket and should not wait a poll interval for a move that has already happened.
    await deps.store.publish(key, message);
  };

  try {
    // POST /rooms
    if (parts.length === 1 && request.method === "POST") {
      const body = await readBody(request);
      const prefer = field(body, "prefer");
      const result = await createRoom(deps.store, {
        now: deps.now(),
        ...(prefer === "white" || prefer === "black" || prefer === "random" ? { prefer } : {}),
      });
      if (!result.ok) {
        json(response, 503, {
          protocol: PROTOCOL,
          type: "rejected",
          reason: "full",
          room: null,
        });
        return true;
      }
      await deps.store.touch(result.room.key, result.seat, deps.now());
      json(response, 200, {
        protocol: PROTOCOL,
        type: "joined",
        seat: result.seat,
        token: result.token,
        room: result.snapshot,
        presence: await deps.store.presence(result.room.key, deps.now()),
      });
      return true;
    }

    const key = parts[1];
    if (key === undefined) return false;

    // GET /rooms/:key
    if (parts.length === 2 && request.method === "GET") {
      const seat = url.searchParams.get("seat");
      if (seat === "white" || seat === "black") {
        // A poll is this transport's heartbeat. Without it the seat ages into `away` while
        // the player is sitting right there.
        await deps.store.touch(key, seat, deps.now());
      }
      const room = await deps.store.get(key);
      if (room === null || room.expiresAt <= deps.now()) {
        json(response, 404, {
          protocol: PROTOCOL,
          type: "rejected",
          reason: "not-found",
          room: null,
        });
        return true;
      }
      const status = replay(room.moves)?.status ?? "playing";
      json(response, 200, {
        protocol: PROTOCOL,
        room: snapshot(room, status),
        presence: await deps.store.presence(key, deps.now()),
      });
      return true;
    }

    if (parts.length !== 3 || request.method !== "POST") return false;
    const body = await readBody(request);
    const token = field(body, "token");

    if (parts[2] === "join") {
      const prefer = field(body, "prefer");
      const result = await joinRoom(deps.store, {
        key,
        now: deps.now(),
        ...(token === undefined ? {} : { token }),
        ...(prefer === "white" || prefer === "black" || prefer === "random" ? { prefer } : {}),
      });
      if (!result.ok) {
        json(response, result.reason === "full" ? 409 : 404, {
          protocol: PROTOCOL,
          type: "rejected",
          reason: result.reason,
          room: null,
        });
        return true;
      }
      await deps.store.touch(key, result.seat, deps.now());
      const presence = await deps.store.presence(key, deps.now());
      if (result.fresh) {
        await publish(key, { protocol: PROTOCOL, type: "presence", key, presence });
        // The seat took the room's version with it, and the player already there is still
        // holding the old one. See the same publish in `hub.ts` for what that breaks.
        await publish(key, {
          protocol: PROTOCOL,
          type: "moved",
          uci: "",
          room: result.snapshot,
        });
      }
      json(response, 200, {
        protocol: PROTOCOL,
        type: "joined",
        seat: result.seat,
        token: result.token,
        room: result.snapshot,
        presence,
      });
      return true;
    }

    if (parts[2] === "move" || parts[2] === "rematch") {
      if (token === undefined) {
        json(response, 401, {
          protocol: PROTOCOL,
          type: "rejected",
          reason: "not-your-seat",
          room: null,
        });
        return true;
      }
      const result =
        parts[2] === "rematch"
          ? await rematch(deps.store, { key, token, now: deps.now() })
          : await playMove(deps.store, {
              key,
              token,
              uci: field(body, "uci") ?? "",
              at: Number((body as Record<string, unknown>)?.at ?? -1),
              now: deps.now(),
            });

      if (!result.ok) {
        json(response, 409, {
          protocol: PROTOCOL,
          type: "rejected",
          reason: result.reason,
          room: result.snapshot,
        });
        return true;
      }
      const message: ServerMessage = {
        protocol: PROTOCOL,
        type: "moved",
        uci: result.uci,
        room: result.snapshot,
      };
      await publish(key, message);
      json(response, 200, message);
      return true;
    }

    return false;
  } catch (error) {
    console.error("[room] http call failed", error);
    json(response, 500, { error: "unavailable" });
    return true;
  }
}
