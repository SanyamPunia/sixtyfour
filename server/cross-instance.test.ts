/**
 * Two servers, one Redis, one game.
 *
 * This is the claim the whole transport choice rests on. Nothing routes a second player to
 * the same process as the first, so if a move only reaches the sockets attached to the
 * instance that received it, the feature is broken in exactly the case it exists for, and
 * broken invisibly: every test that runs one server passes.
 *
 * So this one runs two, each with its own connections, and puts one player on each.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "../lib/room/protocol.ts";
import { PROTOCOL } from "../lib/room/protocol.ts";
import { RedisRoomStore } from "../lib/room/redis-store.ts";
import { type RoomServer, startRoomServer } from "./start.ts";

const ORIGIN = "http://localhost:3000";
const REDIS_URL = process.env.REDIS_URL ?? "";
const skip = REDIS_URL === "" ? { skip: "no REDIS_URL, skipping the cross-instance run" } : {};

let alpha: { store: RedisRoomStore; server: RoomServer } | null = null;
let beta: { store: RedisRoomStore; server: RoomServer } | null = null;
const sockets: WebSocket[] = [];

if (REDIS_URL !== "") {
  before(async () => {
    // One prefix shared by both, which is what makes them the same deployment. Separate
    // store objects mean separate connections, which is what makes them separate instances.
    const prefix = `xtest:${randomUUID().slice(0, 8)}:`;
    const storeA = new RedisRoomStore(REDIS_URL, { prefix });
    const storeB = new RedisRoomStore(REDIS_URL, { prefix });
    alpha = {
      store: storeA,
      server: await startRoomServer({ store: storeA, origins: [ORIGIN] }),
    };
    beta = {
      store: storeB,
      server: await startRoomServer({ store: storeB, origins: [ORIGIN] }),
    };
  });

  after(async () => {
    for (const socket of sockets) socket.close();
    await alpha?.server.close();
    await beta?.server.close();
    await alpha?.store.drop();
    await alpha?.store.close();
    await beta?.store.close();
  });
}

function connect(port: number): Promise<{
  send: (m: ClientMessage) => void;
  expect: <T extends ServerMessage["type"]>(
    type: T,
    timeoutMs?: number,
  ) => Promise<Extract<ServerMessage, { type: T }>>;
  expectWhere: <T extends ServerMessage["type"]>(
    type: T,
    matches: (message: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs?: number,
  ) => Promise<Extract<ServerMessage, { type: T }>>;
  clear: () => void;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: ORIGIN });
    const received: ServerMessage[] = [];
    socket.on("message", (raw) => received.push(JSON.parse(String(raw)) as ServerMessage));
    socket.once("error", reject);
    socket.once("open", () => {
      sockets.push(socket);
      resolve({
        send: (m) => socket.send(JSON.stringify(m)),
        expect: async (type, timeoutMs = 6000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const found = received.find((m) => m.type === type);
            if (found !== undefined) return found as never;
            await new Promise((r) => setTimeout(r, 20));
          }
          const seen = received.map((m) => m.type).join(", ") || "nothing";
          throw new Error(`waited for "${type}" across instances and got ${seen}`);
        },
        // Both instances publish a change they each notice, so a room can be told the same
        // true thing twice. Waiting for the state under test rather than for the next
        // message of that type is what makes the assertion about behaviour and not order.
        expectWhere: async (type, matches, timeoutMs = 8000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const found = received.find((m) => m.type === type && matches(m as never));
            if (found !== undefined) return found as never;
            await new Promise((r) => setTimeout(r, 20));
          }
          const seen = JSON.stringify(received.filter((m) => m.type === type));
          throw new Error(`no "${type}" matched across instances. Saw ${seen}`);
        },
        clear: () => {
          received.length = 0;
        },
        close: () => socket.close(),
      });
    });
  });
}

describe("two instances behind one store", () => {
  test("a room created on one is joinable on the other", skip, async () => {
    const white = await connect((alpha as NonNullable<typeof alpha>).server.port);
    white.send({ protocol: PROTOCOL, type: "create", prefer: "white" });
    const hosted = await white.expect("joined");

    const black = await connect((beta as NonNullable<typeof beta>).server.port);
    black.send({ protocol: PROTOCOL, type: "join", key: hosted.room.key });
    const guest = await black.expect("joined");

    assert.equal(guest.seat, "black");
    assert.equal(guest.room.key, hosted.room.key);
  });

  test("a move made on one instance arrives on the other", skip, async () => {
    const white = await connect((alpha as NonNullable<typeof alpha>).server.port);
    white.send({ protocol: PROTOCOL, type: "create", prefer: "white" });
    const hosted = await white.expect("joined");

    const black = await connect((beta as NonNullable<typeof beta>).server.port);
    black.send({ protocol: PROTOCOL, type: "join", key: hosted.room.key });
    const guest = await black.expect("joined");
    white.clear();
    black.clear();

    white.send({
      protocol: PROTOCOL,
      type: "move",
      key: hosted.room.key,
      token: hosted.token,
      uci: "e2e4",
      at: guest.room.version,
    });

    // Matched on content, not on being the next of its type. Taking a seat also publishes
    // a snapshot, so "the next moved message" is not necessarily the move.
    const heard = await black.expectWhere("moved", (m) => m.room.moves.length === 1);
    assert.deepEqual(heard.room.moves, ["e2e4"]);

    // And back the other way, so this is not one-directional by accident.
    black.clear();
    white.clear();
    black.send({
      protocol: PROTOCOL,
      type: "move",
      key: hosted.room.key,
      token: guest.token,
      uci: "e7e5",
      at: heard.room.version,
    });
    const answered = await white.expectWhere("moved", (m) => m.room.moves.length === 2);
    assert.deepEqual(answered.room.moves, ["e2e4", "e7e5"]);
  });

  test("presence crosses instances when a player drops", skip, async () => {
    const white = await connect((alpha as NonNullable<typeof alpha>).server.port);
    white.send({ protocol: PROTOCOL, type: "create", prefer: "white" });
    const hosted = await white.expect("joined");

    const black = await connect((beta as NonNullable<typeof beta>).server.port);
    black.send({ protocol: PROTOCOL, type: "join", key: hosted.room.key });
    await black.expect("joined");
    black.clear();

    white.close();
    const presence = await black.expectWhere("presence", (m) => m.presence.white !== "here");
    assert.equal(
      presence.presence.white,
      "away",
      "a clean disconnect skipped the grace window",
    );
    assert.equal(presence.presence.black, "here", "the player still there was marked absent");
  });
});
