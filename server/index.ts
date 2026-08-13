/**
 * The room server process.
 *
 * A plain Node process: an HTTP server for the health check and a WebSocket server on the
 * same port for the game, with one Redis behind both. It is deliberately ordinary. Nothing
 * here is tied to a particular host, so it runs the same way on a laptop and on whatever
 * ends up paying for it.
 *
 * Run it with `pnpm room`. It is not part of the Next build, and the site never imports it.
 */

import { MemoryRoomStore } from "../lib/room/memory-store.ts";
import { RedisRoomStore } from "../lib/room/redis-store.ts";
import type { RoomStore } from "../lib/room/store.ts";
import { parseOrigins } from "./guards.ts";
import { startRoomServer } from "./start.ts";

const PORT = Number(process.env.PORT ?? 3001);
const REDIS_URL = process.env.REDIS_URL ?? "";
const ORIGINS = parseOrigins(process.env.ALLOWED_ORIGINS ?? "http://localhost:3000");

function buildStore(): { store: RoomStore; kind: string } {
  if (REDIS_URL !== "") return { store: new RedisRoomStore(REDIS_URL), kind: "redis" };
  // Usable for a single-process run on a laptop, and wrong for anything else: a second
  // instance would not see these rooms, and a restart forgets them. Loud on purpose.
  console.warn("[room] REDIS_URL is not set. Rooms are in memory and will not survive.");
  return { store: new MemoryRoomStore(), kind: "memory" };
}

const { store, kind } = buildStore();

const server = await startRoomServer({ store, origins: ORIGINS, port: PORT, storeKind: kind });
console.log(`[room] listening on ${server.port}, store ${kind}, origins ${ORIGINS.join(" ")}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`[room] ${signal}, closing`);
  await server.close();
  await store.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
