/**
 * Starting a room server, separated from deciding to start one.
 *
 * `index.ts` reads the environment and handles signals. This file takes what it decided and
 * builds the thing. The split exists so a test can start a real server on a real port with
 * a store of its choosing, which is the only way to check the parts that are about sockets
 * rather than about rooms: the origin refusal, the relay between two clients, and what the
 * other player sees when one of them vanishes.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { RoomStore } from "../lib/room/store.ts";
import { originAllowed } from "./guards.ts";
import { handleRoomHttp } from "./http-api.ts";
import { Hub } from "./hub.ts";

/** A move message is about eighty bytes. Anything approaching this is not a game. */
const MAX_PAYLOAD = 4096;

/** Long enough not to fight a slow network, short enough to free a dead socket's seat. */
const PROBE_MS = 30_000;

export interface RoomServerOptions {
  store: RoomStore;
  origins: readonly string[];
  /** Zero asks the operating system for a free one, which is what tests want. */
  port?: number;
  /** Reported by the health check, so a deployment can be checked for its store. */
  storeKind?: string;
}

export interface RoomServer {
  port: number;
  hub: Hub;
  http: Server;
  close(): Promise<void>;
}

export function startRoomServer(options: RoomServerOptions): Promise<RoomServer> {
  const origins = [...options.origins];
  const hub = new Hub(options.store);

  const now = () => Date.now();

  const http = createServer((request: IncomingMessage, response: ServerResponse) => {
    const origin = request.headers.origin;
    if (origin !== undefined && originAllowed(origin, origins)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }

    if (request.url !== undefined && request.url.startsWith("/rooms")) {
      void handleRoomHttp(request, response, { store: options.store, origins, now }).then(
        (handled) => {
          if (handled) return;
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false }));
        },
      );
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          store: options.storeKind ?? "unknown",
          connections: hub.connectionCount,
          rooms: hub.roomCount,
          uptime: Math.round(process.uptime()),
        }),
      );
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false }));
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  /**
   * The upgrade is handled by hand rather than through `verifyClient`.
   *
   * A refused handshake should be an HTTP response the browser can report, not a socket
   * that opens and closes for no stated reason. This is also the only place the origin can
   * be checked at all: an upgrade never gets a CORS preflight, so nothing before this point
   * has looked at where the request came from.
   */
  http.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!originAllowed(request.headers.origin, origins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => hub.attach(client));
  });

  const probe = setInterval(() => hub.probe(), PROBE_MS);
  probe.unref?.();

  return new Promise((resolve) => {
    http.listen(options.port ?? 0, () => {
      const port = (http.address() as AddressInfo).port;
      resolve({
        port,
        hub,
        http,
        close: async () => {
          clearInterval(probe);
          await hub.close();
          sockets.close();
          await new Promise<void>((done) => http.close(() => done()));
        },
      });
    });
  });
}
