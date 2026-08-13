/**
 * The fallback transport, and the one thing about it that is easy to get wrong.
 *
 * Two players do not have to be on the same transport. One can be behind a proxy that will
 * not carry a socket while the other is on a normal connection, and neither knows about the
 * other's situation. So the interesting test is not that polling works, it is that a move
 * posted over HTTP reaches a socket, and that a move sent over a socket shows up in a poll.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import WebSocket from "ws";
import { MemoryRoomStore } from "../lib/room/memory-store.ts";
import type { RoomSnapshot, SeatMap, ServerMessage } from "../lib/room/protocol.ts";
import { PROTOCOL } from "../lib/room/protocol.ts";
import { type RoomServer, startRoomServer } from "./start.ts";

const ORIGIN = "http://localhost:3000";

let store: MemoryRoomStore;
let server: RoomServer;
let base: string;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  store = new MemoryRoomStore();
  server = await startRoomServer({ store, origins: [ORIGIN] });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server.close();
  await store.close();
});

async function post(path: string, body: unknown, origin = ORIGIN) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, never> };
}

async function get(path: string) {
  const response = await fetch(base + path, { headers: { Origin: ORIGIN } });
  return {
    status: response.status,
    body: (await response.json()) as {
      room?: RoomSnapshot;
      presence?: SeatMap<string>;
      reason?: string;
    },
  };
}

function openSocket(): Promise<{
  send: (m: object) => void;
  expect: (
    type: string,
    timeoutMs?: number,
    matches?: (m: ServerMessage) => boolean,
  ) => Promise<ServerMessage>;
  clear: () => void;
}> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: ORIGIN });
    const received: ServerMessage[] = [];
    socket.on("message", (raw) => received.push(JSON.parse(String(raw)) as ServerMessage));
    socket.once("error", reject);
    socket.once("open", () => {
      sockets.push(socket);
      resolve({
        send: (m) => socket.send(JSON.stringify({ protocol: PROTOCOL, ...m })),
        // Matched on content when asked, because taking a seat also publishes a snapshot
        // and "the next message of this type" is then not the one under test.
        expect: async (type, timeoutMs = 3000, matches) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const found = received.find(
              (m) => m.type === type && (matches === undefined || matches(m)),
            );
            if (found !== undefined) return found;
            await new Promise((r) => setTimeout(r, 10));
          }
          throw new Error(
            `waited for "${type}", saw ${received.map((m) => m.type).join(", ")}`,
          );
        },
        clear: () => {
          received.length = 0;
        },
      });
    });
  });
}

describe("http rooms", () => {
  test("a room can be created, joined and played without any socket", async () => {
    const created = await post("/rooms", { prefer: "white" });
    assert.equal(created.status, 200);
    assert.equal(created.body.type, "joined");
    assert.equal(created.body.seat, "white");

    const key = (created.body.room as unknown as RoomSnapshot).key;
    const joined = await post(`/rooms/${key}/join`, {});
    assert.equal(joined.body.seat, "black");

    const whiteToken = created.body.token as unknown as string;
    const blackToken = joined.body.token as unknown as string;

    const first = await post(`/rooms/${key}/move`, { token: whiteToken, uci: "e2e4", at: 1 });
    assert.equal(first.status, 200);
    assert.deepEqual((first.body.room as unknown as RoomSnapshot).moves, ["e2e4"]);

    const reply = await post(`/rooms/${key}/move`, { token: blackToken, uci: "e7e5", at: 2 });
    assert.deepEqual((reply.body.room as unknown as RoomSnapshot).moves, ["e2e4", "e7e5"]);

    const polled = await get(`/rooms/${key}?seat=white`);
    assert.deepEqual(polled.body.room?.moves, ["e2e4", "e7e5"]);
    assert.equal(polled.body.presence?.white, "here", "polling did not keep the seat warm");
  });

  test("the same refusals apply over http", async () => {
    const created = await post("/rooms", { prefer: "white" });
    const room = created.body.room as unknown as RoomSnapshot;
    const key = room.key;
    const token = created.body.token as unknown as string;
    // Read rather than assumed. A version is bumped by a join as well as by a move, and
    // guessing it here would test staleness instead of the thing each case is named for.
    const at = room.version;

    const illegal = await post(`/rooms/${key}/move`, { token, uci: "e2e5", at });
    assert.equal(illegal.status, 409);
    assert.equal(illegal.body.reason, "illegal");

    const behind = await post(`/rooms/${key}/move`, { token, uci: "e2e4", at: at + 5 });
    assert.equal(behind.body.reason, "stale");

    const stranger = await post(`/rooms/${key}/move`, { token: "nope", uci: "e2e4", at });
    assert.equal(stranger.body.reason, "not-your-seat");

    const missing = await post(`/rooms/${key}/move`, { uci: "e2e4", at });
    assert.equal(missing.status, 401);

    assert.equal((await get("/rooms/ZZZZZZ")).status, 404);
    assert.deepEqual((await store.get(key))?.moves, []);
  });

  test("another site cannot call these", async () => {
    // A plain POST reaches the handler before a preflight could have stopped it, so this
    // has to be refused here and not left to the browser.
    const refused = await post("/rooms", { prefer: "white" }, "https://elsewhere.example");
    assert.equal(refused.status, 403);
    assert.equal(await store.activeCount(Date.now()), 0);
  });

  test("a preflight is answered", async () => {
    const response = await fetch(`${base}/rooms`, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  });

  test("the room cap is the same cap", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await post("/rooms", {})).status, 200);
    const over = await post("/rooms", {});
    assert.equal(over.status, 503);
    assert.equal(over.body.reason, "full");
  });
});

describe("mixed transports", () => {
  test("a move posted over http reaches a player on a socket", async () => {
    const white = await openSocket();
    white.send({ type: "create", prefer: "white" });
    const hosted = (await white.expect("joined")) as Extract<ServerMessage, { type: "joined" }>;
    const key = hosted.room.key;

    const joined = await post(`/rooms/${key}/join`, {});
    const blackToken = joined.body.token as unknown as string;
    white.clear();

    white.send({
      type: "move",
      key,
      token: hosted.token,
      uci: "e2e4",
      at: joined.body.room ? (joined.body.room as unknown as RoomSnapshot).version : 1,
    });
    const seen = (await white.expect(
      "moved",
      3000,
      (m) => "room" in m && m.room !== null && m.room.moves.length === 1,
    )) as Extract<ServerMessage, { type: "moved" }>;
    assert.deepEqual(seen.room.moves, ["e2e4"]);

    // The polling player sees it on their next ask.
    const polled = await get(`/rooms/${key}?seat=black`);
    assert.deepEqual(polled.body.room?.moves, ["e2e4"]);

    // And their reply, posted, arrives on the socket without waiting for anything.
    white.clear();
    await post(`/rooms/${key}/move`, {
      token: blackToken,
      uci: "e7e5",
      at: seen.room.version,
    });
    const answered = (await white.expect(
      "moved",
      3000,
      (m) => "room" in m && m.room !== null && m.room.moves.length === 2,
    )) as Extract<ServerMessage, { type: "moved" }>;
    assert.deepEqual(
      answered.room.moves,
      ["e2e4", "e7e5"],
      "the socket never heard the posted move",
    );
  });

  test("a player joining over http shows up as present on the socket", async () => {
    const white = await openSocket();
    white.send({ type: "create", prefer: "white" });
    const hosted = (await white.expect("joined")) as Extract<ServerMessage, { type: "joined" }>;
    white.clear();

    await post(`/rooms/${hosted.room.key}/join`, {});

    const presence = (await white.expect("presence")) as Extract<
      ServerMessage,
      { type: "presence" }
    >;
    assert.equal(presence.presence.black, "here");
  });
});
