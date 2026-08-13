/**
 * The parts that only exist once there is a socket.
 *
 * Everything about rooms is already proven in `lib/room`, against both stores, with no
 * network involved. What is left is what this layer adds: whether a refused origin is
 * actually refused, whether one player's move reaches the other, whether a rejection goes
 * to the player who caused it and nobody else, and what the board says about someone who
 * has stopped answering.
 *
 * These run against a real server on a real port with real clients, because none of those
 * questions can be answered without one.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import WebSocket from "ws";
import { MemoryRoomStore } from "../lib/room/memory-store.ts";
import type { ClientMessage, ServerMessage } from "../lib/room/protocol.ts";
import { PROTOCOL } from "../lib/room/protocol.ts";
import { type RoomServer, startRoomServer } from "./start.ts";

const ORIGIN = "http://localhost:3000";

let store: MemoryRoomStore;
let server: RoomServer;
const opened: Client[] = [];

beforeEach(async () => {
  store = new MemoryRoomStore();
  server = await startRoomServer({ store, origins: [ORIGIN] });
});

afterEach(async () => {
  for (const client of opened.splice(0)) client.close();
  await server.close();
  await store.close();
});

/** A socket that remembers what it was told, so a test can assert on absence as well. */
class Client {
  private socket: WebSocket;
  readonly received: ServerMessage[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (raw) => {
      this.received.push(JSON.parse(String(raw)) as ServerMessage);
    });
  }

  static open(port: number, origin: string = ORIGIN): Promise<Client> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
      const client = new Client(socket);
      socket.once("open", () => {
        opened.push(client);
        resolve(client);
      });
      socket.once("error", reject);
    });
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Resolves with the first message matching, waiting for it to arrive if it has not. */
  async expect<T extends ServerMessage["type"]>(
    type: T,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.received.find((m) => m.type === type);
      if (found !== undefined) return found as Extract<ServerMessage, { type: T }>;
      await pause(10);
    }
    const seen = this.received.map((m) => m.type).join(", ") || "nothing";
    throw new Error(`waited for "${type}" and got ${seen}`);
  }

  countOf(type: ServerMessage["type"]): number {
    return this.received.filter((m) => m.type === type).length;
  }

  clear(): void {
    this.received.length = 0;
  }

  close(): void {
    this.socket.close();
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The usual setup: two connected players, White having created the room. */
async function pair() {
  const white = await Client.open(server.port);
  white.send({ protocol: PROTOCOL, type: "create", prefer: "white" });
  const hosted = await white.expect("joined");

  const black = await Client.open(server.port);
  black.send({ protocol: PROTOCOL, type: "join", key: hosted.room.key });
  const guest = await black.expect("joined");

  // Taking a seat advances the room's version and the host is told, so waiting for that
  // here is what makes a later `expect("moved")` unambiguously about a move. Without it
  // the tests race the seat update and pass or fail on scheduling.
  await white.expect("moved");

  white.clear();
  black.clear();
  return { white, black, key: hosted.room.key, hosted, guest };
}

describe("handshake", () => {
  test("a page from another site cannot open a socket", async () => {
    await assert.rejects(
      () => Client.open(server.port, "https://elsewhere.example"),
      /403/,
      "a cross-origin handshake was accepted",
    );
  });

  test("the allowed origin connects", async () => {
    const client = await Client.open(server.port);
    assert.equal(client.isOpen, true);
  });

  test("the health check reports the server", async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; connections: number };
    assert.equal(body.ok, true);
    assert.equal(typeof body.connections, "number");
  });

  test("a message from a different protocol version is refused, not guessed at", async () => {
    const client = await Client.open(server.port);
    client.send({ protocol: PROTOCOL + 1, type: "create" } as ClientMessage);
    const error = await client.expect("error");
    assert.equal(error.code, "protocol");
    assert.equal(client.countOf("joined"), 0);
  });

  test("nonsense on the socket does not take the server down", async () => {
    const client = await Client.open(server.port);
    client.send("not json at all" as unknown as ClientMessage);
    const error = await client.expect("error");
    assert.equal(error.code, "malformed");

    // Still usable afterwards, which is the actual claim.
    client.clear();
    client.send({ protocol: PROTOCOL, type: "create" });
    await client.expect("joined");
  });
});

describe("seating", () => {
  test("creating seats you and hands back a key", async () => {
    const client = await Client.open(server.port);
    client.send({ protocol: PROTOCOL, type: "create", prefer: "white" });
    const joined = await client.expect("joined");
    assert.equal(joined.seat, "white");
    assert.equal(joined.room.key.length, 6);
    assert.deepEqual(joined.room.moves, []);
    assert.equal(joined.presence.white, "here");
    assert.equal(joined.presence.black, "gone");
  });

  test("the second player gets the other seat and both read as here", async () => {
    const { hosted, guest } = await pair();
    assert.equal(hosted.seat, "white");
    assert.equal(guest.seat, "black");
    assert.notEqual(guest.token, hosted.token);
    assert.deepEqual(guest.presence, { white: "here", black: "here" });
  });

  test("the first player is told the second arrived", async () => {
    const white = await Client.open(server.port);
    white.send({ protocol: PROTOCOL, type: "create", prefer: "white" });
    const hosted = await white.expect("joined");
    white.clear();

    const black = await Client.open(server.port);
    black.send({ protocol: PROTOCOL, type: "join", key: hosted.room.key });
    await black.expect("joined");

    const presence = await white.expect("presence");
    assert.deepEqual(presence.presence, { white: "here", black: "here" });
  });

  test("a third player is refused", async () => {
    const { key } = await pair();
    const third = await Client.open(server.port);
    third.send({ protocol: PROTOCOL, type: "join", key });
    const rejected = await third.expect("rejected");
    assert.equal(rejected.reason, "full");
  });

  test("an unknown key is refused", async () => {
    const client = await Client.open(server.port);
    client.send({ protocol: PROTOCOL, type: "join", key: "ZZZZZZ" });
    assert.equal((await client.expect("rejected")).reason, "not-found");
  });

  test("reconnecting with the token returns to the same seat", async () => {
    const { white, key, hosted } = await pair();
    white.close();
    await pause(50);

    const again = await Client.open(server.port);
    again.send({ protocol: PROTOCOL, type: "join", key, token: hosted.token });
    const rejoined = await again.expect("joined");
    assert.equal(rejoined.seat, "white");
    assert.equal(rejoined.token, hosted.token);
  });
});

describe("moves", () => {
  test("the opening move works from the version the room actually handed out", async () => {
    /*
     * The regression this exists for. Taking a seat advances the room's version, because
     * that is what makes the seat race safe. The player already sitting there is holding
     * the version from when they created the room, so unless they are told, their first
     * move is judged against a board that has moved on and is refused as stale.
     *
     * Everything reports healthy in that state. The game just never starts.
     */
    const white = await Client.open(server.port);
    white.send({ protocol: PROTOCOL, type: "create", prefer: "white" });
    const hosted = await white.expect("joined");
    white.clear();

    const black = await Client.open(server.port);
    black.send({ protocol: PROTOCOL, type: "join", key: hosted.room.key });
    await black.expect("joined");

    const update = await white.expect("moved");
    assert.ok(
      update.room.version > hosted.room.version,
      `white was never told the room moved past ${hosted.room.version}`,
    );

    white.clear();
    black.clear();
    white.send({
      protocol: PROTOCOL,
      type: "move",
      key: hosted.room.key,
      token: hosted.token,
      uci: "e2e4",
      at: update.room.version,
    });

    const played = await white.expect("moved");
    assert.deepEqual(played.room.moves, ["e2e4"], "the opening move was refused");
    assert.equal(white.countOf("rejected"), 0);
  });

  test("a move reaches both players with the same board", async () => {
    const { white, black, hosted } = await pair();
    white.send({
      protocol: PROTOCOL,
      type: "move",
      key: hosted.room.key,
      token: hosted.token,
      uci: "e2e4",
      at: 1,
    });

    const mine = await white.expect("moved");
    const theirs = await black.expect("moved");
    assert.equal(mine.uci, "e2e4");
    assert.deepEqual(mine.room, theirs.room, "the two boards disagreed");
    assert.deepEqual(mine.room.moves, ["e2e4"]);
    assert.equal(mine.room.version, 2);
  });

  test("a full game alternates and ends", async () => {
    const { white, black, hosted, guest } = await pair();
    const send = (who: typeof white, token: string, uci: string, at: number) =>
      who.send({ protocol: PROTOCOL, type: "move", key: hosted.room.key, token, uci, at });

    // Fool's mate, which is the shortest way to a finished game.
    send(white, hosted.token, "f2f3", 1);
    await black.expect("moved");
    send(black, guest.token, "e7e5", 2);
    await white.expect("moved", 2000);
    black.clear();
    send(white, hosted.token, "g2g4", 3);
    await black.expect("moved");
    white.clear();
    send(black, guest.token, "d8h4", 4);

    const final = await white.expect("moved");
    assert.equal(final.room.status, "checkmate");
    assert.equal(final.room.moves.length, 4);
  });

  test("an illegal move is refused to the mover and nobody else hears it", async () => {
    const { white, black, hosted } = await pair();
    white.send({
      protocol: PROTOCOL,
      type: "move",
      key: hosted.room.key,
      token: hosted.token,
      uci: "e2e5",
      at: 1,
    });

    const rejected = await white.expect("rejected");
    assert.equal(rejected.reason, "illegal");
    assert.deepEqual(rejected.room?.moves, [], "the board took an illegal move");

    // The point of sending it to one socket: the other player's board must not flicker
    // because their opponent fat-fingered something.
    await pause(150);
    assert.equal(black.countOf("moved"), 0);
    assert.equal(black.countOf("rejected"), 0);
  });

  test("moving out of turn is refused", async () => {
    const { black, hosted, guest } = await pair();
    black.send({
      protocol: PROTOCOL,
      type: "move",
      key: hosted.room.key,
      token: guest.token,
      uci: "e7e5",
      at: 1,
    });
    assert.equal((await black.expect("rejected")).reason, "not-your-turn");
  });

  test("a move before joining anything is refused", async () => {
    const client = await Client.open(server.port);
    client.send({
      protocol: PROTOCOL,
      type: "move",
      key: "ZZZZZZ",
      token: "nope",
      uci: "e2e4",
      at: 0,
    });
    assert.equal((await client.expect("rejected")).reason, "not-found");
  });

  test("a rejected move carries the real board back", async () => {
    const { white, black, hosted, guest } = await pair();
    white.send({
      protocol: PROTOCOL,
      type: "move",
      key: hosted.room.key,
      token: hosted.token,
      uci: "e2e4",
      at: 1,
    });
    await black.expect("moved");
    black.clear();

    // Black answers using the version it knew before White's move landed.
    black.send({
      protocol: PROTOCOL,
      type: "move",
      key: hosted.room.key,
      token: guest.token,
      uci: "e7e5",
      at: 1,
    });
    const rejected = await black.expect("rejected");
    assert.equal(rejected.reason, "stale");
    assert.deepEqual(rejected.room?.moves, ["e2e4"], "no board came back to correct with");
    assert.equal(rejected.room?.version, 2);
  });
});

describe("presence", () => {
  test("a player who disconnects is reported away, not gone", async () => {
    const { white, black } = await pair();
    white.close();

    const presence = await black.expect("presence", 3000);
    assert.equal(presence.presence.white, "away");
    assert.equal(presence.presence.black, "here");
  });

  test("coming back inside the window puts them back to here", async () => {
    const { white, black, key, hosted } = await pair();
    white.close();
    await black.expect("presence", 3000);
    black.clear();

    const again = await Client.open(server.port);
    again.send({ protocol: PROTOCOL, type: "join", key, token: hosted.token });
    await again.expect("joined");

    const back = await black.expect("presence", 3000);
    assert.equal(back.presence.white, "here");
  });

  test("an idle room does not chatter", async () => {
    // The sweep runs on a timer, so it has to stay quiet when nothing has changed, or the
    // indicator repaints every two seconds for the whole game.
    const { black } = await pair();
    await pause(SWEEP_OBSERVATION_MS);
    assert.equal(
      black.countOf("presence"),
      0,
      "the sweep published presence with nothing to report",
    );
  });
});

/** Long enough for several sweeps to have run and had the chance to say something. */
const SWEEP_OBSERVATION_MS = 5_000;
