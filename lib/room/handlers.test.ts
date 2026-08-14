/**
 * The whole API, tested with no server running.
 *
 * The route files under `app/api/` are four lines each: read the body, call one of these,
 * return the result. Everything that could be wrong is on this side of that line, so this
 * is where the API is covered rather than in something that has to boot Next first.
 *
 * The service tests already prove the rules. These prove the layer above them: that an
 * untrusted body is read safely, that each refusal arrives with a status a caller can act
 * on, and that nothing leaks a seat token to somebody who did not earn it.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  handleCreate,
  handleJoin,
  handleLeave,
  handleMove,
  handlePoll,
  handleRematch,
  readKey,
} from "./handlers.ts";
import { MemoryRoomStore } from "./memory-store.ts";
import { AWAY_MS } from "./presence.ts";
import type { JoinedBody, RejectedBody, StateBody } from "./protocol.ts";
import { ROOM_CAP } from "./service.ts";

const NOW = 1_700_000_000_000;

let store: MemoryRoomStore;
beforeEach(() => {
  store = new MemoryRoomStore();
});

async function openRoom(prefer: "white" | "black" = "white") {
  const created = await handleCreate(store, { prefer }, NOW);
  const host = created.body as JoinedBody;
  const joined = await handleJoin(store, host.room.key, {}, NOW);
  const guest = joined.body as JoinedBody;
  return { key: host.room.key, host, guest };
}

describe("keys from a url", () => {
  test("a valid key is normalised", () => {
    assert.equal(readKey("k7m2xq"), "K7M2XQ");
    assert.equal(readKey(" K7M-2XQ "), "K7M2XQ");
  });

  test("anything that is not a key is refused before it reaches the store", () => {
    // A key is interpolated into a Redis key name, so it is checked here rather than
    // trusted to be six harmless characters.
    for (const bad of ["", "K7M2X", "K7M2XQZ", "K7M2XO", "*", "../../etc", "a b"]) {
      assert.equal(readKey(bad), null, `${bad} was accepted`);
    }
  });
});

describe("creating", () => {
  test("returns the seat, the token and an empty board", async () => {
    const result = await handleCreate(store, { prefer: "white" }, NOW);
    assert.equal(result.status, 201);
    const body = result.body as JoinedBody;
    assert.equal(body.type, "joined");
    assert.equal(body.seat, "white");
    assert.equal(body.room.key.length, 6);
    assert.deepEqual(body.room.moves, []);
    assert.equal(body.presence.white, "here", "the creator was not marked present");
    assert.equal(body.presence.black, "gone");
  });

  test("an unreadable body still creates, with a random side", async () => {
    // The body is untrusted, so nothing in it is required. A missing preference is a
    // preference for either.
    for (const body of [null, {}, { prefer: 42 }, { prefer: "purple" }, "nonsense"]) {
      const result = await handleCreate(new MemoryRoomStore(), body, NOW);
      assert.equal(result.status, 201, `body ${JSON.stringify(body)} was refused`);
    }
  });

  test("the cap answers with a status a caller can act on", async () => {
    for (let i = 0; i < ROOM_CAP; i++) await handleCreate(store, {}, NOW);
    const over = await handleCreate(store, {}, NOW);
    assert.equal(over.status, 409);
    assert.equal((over.body as RejectedBody).reason, "full");
  });
});

describe("joining", () => {
  test("the second player gets the other seat", async () => {
    const { host, guest } = await openRoom("white");
    assert.equal(guest.seat, "black");
    assert.notEqual(guest.token, host.token);
    assert.deepEqual(guest.presence, { white: "here", black: "here" });
  });

  test("a reload keeps its own seat", async () => {
    const { key, host } = await openRoom("white");
    const again = await handleJoin(store, key, { token: host.token }, NOW);
    const body = again.body as JoinedBody;
    assert.equal(body.seat, "white");
    assert.equal(body.token, host.token);
  });

  test("a third player is refused with a conflict", async () => {
    const { key } = await openRoom();
    const third = await handleJoin(store, key, {}, NOW);
    assert.equal(third.status, 409);
    assert.equal((third.body as RejectedBody).reason, "full");
  });

  test("an unknown key is a not found", async () => {
    const missing = await handleJoin(store, "ZZZZZZ", {}, NOW);
    assert.equal(missing.status, 404);
    assert.equal((missing.body as RejectedBody).reason, "not-found");
  });
});

describe("moving", () => {
  test("a legal move from the right seat is written", async () => {
    const { key, host, guest } = await openRoom("white");
    const result = await handleMove(
      store,
      key,
      { token: host.token, uci: "e2e4", at: guest.room.version },
      NOW,
    );
    assert.equal(result.status, 200);
    const body = result.body as StateBody;
    assert.deepEqual(body.room.moves, ["e2e4"]);
    assert.equal(body.presence.white, "here", "moving did not count as being present");
  });

  test("each refusal carries its own status", async () => {
    const { key, host, guest } = await openRoom("white");
    const at = guest.room.version;

    const cases: [string, unknown, number, string][] = [
      ["illegal", { token: host.token, uci: "e2e5", at }, 422, "illegal"],
      ["out of turn", { token: guest.token, uci: "e7e5", at }, 409, "not-your-turn"],
      ["a stranger", { token: "nope", uci: "e2e4", at }, 403, "not-your-seat"],
      ["no token", { uci: "e2e4", at }, 403, "not-your-seat"],
      ["no move", { token: host.token, at }, 422, "illegal"],
      ["behind", { token: host.token, uci: "e2e4", at: at + 5 }, 409, "stale"],
    ];

    for (const [name, body, status, reason] of cases) {
      const result = await handleMove(store, key, body, NOW);
      assert.equal(result.status, status, `${name} had the wrong status`);
      assert.equal(
        (result.body as RejectedBody).reason,
        reason,
        `${name} had the wrong reason`,
      );
    }
    assert.deepEqual((await store.get(key))?.moves, [], "a refused move reached the board");
  });

  test("a refusal carries the real board back", async () => {
    const { key, host, guest } = await openRoom("white");
    await handleMove(
      store,
      key,
      { token: host.token, uci: "e2e4", at: guest.room.version },
      NOW,
    );

    const late = await handleMove(
      store,
      key,
      { token: guest.token, uci: "e7e5", at: guest.room.version },
      NOW,
    );
    const body = late.body as RejectedBody;
    assert.equal(body.reason, "stale");
    assert.deepEqual(body.room?.moves, ["e2e4"], "no board came back to correct with");
  });
});

describe("polling", () => {
  test("returns the board and both seats", async () => {
    const { key, host, guest } = await openRoom("white");
    await handleMove(
      store,
      key,
      { token: host.token, uci: "e2e4", at: guest.room.version },
      NOW,
    );

    const result = await handlePoll(store, key, "black", NOW);
    assert.equal(result.status, 200);
    const body = result.body as StateBody;
    assert.deepEqual(body.room.moves, ["e2e4"]);
    assert.equal(body.presence.black, "here", "polling did not keep the seat warm");
  });

  test("a poll is what keeps a seat present", async () => {
    const { key } = await openRoom("white");
    // Long enough that the join no longer counts for anything.
    const later = NOW + 60_000;
    assert.equal((await handlePoll(store, key, null, later)).status, 200);
    assert.equal(
      ((await handlePoll(store, key, null, later)).body as StateBody).presence.white,
      "gone",
    );

    const kept = await handlePoll(store, key, "white", later);
    assert.equal((kept.body as StateBody).presence.white, "here");
  });

  test("a claimed seat buys nothing beyond presence", async () => {
    // The seat in the query string is not the token. Claiming one you do not hold cannot
    // move a piece and cannot read anything a seatless poll would not also return.
    const { key } = await openRoom("white");
    const honest = (await handlePoll(store, key, null, NOW)).body as StateBody;
    const claimed = (await handlePoll(store, key, "black", NOW)).body as StateBody;
    assert.deepEqual(claimed.room, honest.room);
  });

  test("an unknown room is a not found", async () => {
    assert.equal((await handlePoll(store, "ZZZZZZ", null, NOW)).status, 404);
  });

  test("an expired room is gone even with the right key", async () => {
    const { key } = await openRoom();
    const later = NOW + 25 * 60 * 60 * 1000;
    assert.equal((await handlePoll(store, key, null, later)).status, 404);
  });
});

describe("rematch", () => {
  test("is refused while the game is live", async () => {
    const { key, host } = await openRoom("white");
    const result = await handleRematch(store, key, { token: host.token }, NOW);
    assert.equal(result.status, 409);
  });

  test("clears the board once the game is over", async () => {
    const { key, host, guest } = await openRoom("white");
    const tokens = { white: host.token, black: guest.token };
    let at = guest.room.version;
    // Fool's mate, the shortest way to a finished game.
    for (const [index, uci] of ["f2f3", "e7e5", "g2g4", "d8h4"].entries()) {
      const token = index % 2 === 0 ? tokens.white : tokens.black;
      const result = await handleMove(store, key, { token, uci, at }, NOW);
      assert.equal(result.status, 200, `${uci} was refused`);
      at = (result.body as StateBody).room.version;
    }

    const done = await handlePoll(store, key, null, NOW);
    assert.equal((done.body as StateBody).room.status, "checkmate");

    const again = await handleRematch(store, key, { token: host.token }, NOW);
    assert.equal(again.status, 200);
    assert.deepEqual((again.body as StateBody).room.moves, []);
    // Both seats survive, so nobody has to rejoin.
    const room = await store.get(key);
    assert.equal(room?.seats.white, tokens.white);
    assert.equal(room?.seats.black, tokens.black);
  });

  test("a stranger cannot restart someone else's game", async () => {
    const { key } = await openRoom("white");
    const result = await handleRematch(store, key, { token: "nope" }, NOW);
    assert.equal(result.status, 403);
  });
});

describe("secrets", () => {
  test("no poll, state or refusal ever carries a token", async () => {
    const { key, host, guest } = await openRoom("white");
    const moved = await handleMove(
      store,
      key,
      { token: host.token, uci: "e2e4", at: guest.room.version },
      NOW,
    );
    const refused = await handleMove(
      store,
      key,
      { token: host.token, uci: "e2e4", at: 0 },
      NOW,
    );
    const polled = await handlePoll(store, key, "white", NOW);

    for (const [name, result] of [
      ["a move", moved],
      ["a refusal", refused],
      ["a poll", polled],
    ] as const) {
      const text = JSON.stringify(result.body);
      assert.equal(text.includes(host.token), false, `${name} leaked the white token`);
      assert.equal(text.includes(guest.token), false, `${name} leaked the black token`);
    }
  });
});

/**
 * Giving a seat back.
 *
 * The bugs these cover were all the same shape: a seat stays claimed by somebody who is not
 * there, and the room then refuses the only two people entitled to be in it. It is the one
 * failure a player cannot work around, because the room looks full and the key looks wrong.
 */
describe("leaving", () => {
  test("frees the seat for someone else", async () => {
    const { key, host } = await openRoom("white");
    assert.equal((await handleJoin(store, key, {}, NOW)).status, 409, "room was not full");

    assert.equal((await handleLeave(store, key, { token: host.token }, NOW)).status, 200);

    const replacement = await handleJoin(store, key, {}, NOW);
    assert.equal(replacement.status, 200, "the freed seat was still refused");
    assert.equal((replacement.body as JoinedBody).seat, "white");
  });

  test("the last player out closes the room", async () => {
    const { key, host, guest } = await openRoom("white");
    await handleLeave(store, key, { token: host.token }, NOW);
    assert.notEqual(await store.get(key), null, "the room went with the first player");

    await handleLeave(store, key, { token: guest.token }, NOW);
    assert.equal(await store.get(key), null, "an empty room was left holding a slot");
    assert.equal(await store.activeCount(NOW), 0);
  });

  test("a token that holds no seat is not an error", async () => {
    // Called from a tab that is closing, where there is nothing left to retry with, so the
    // useful answer to "I am not in this room" is that this is already true.
    const { key } = await openRoom("white");
    assert.equal((await handleLeave(store, key, { token: "not-a-seat" }, NOW)).status, 200);
  });

  test("leaving does not disturb the other player or the board", async () => {
    const { key, host, guest } = await openRoom("white");
    await handleMove(
      store,
      key,
      { token: host.token, uci: "e2e4", at: guest.room.version },
      NOW,
    );
    await handleLeave(store, key, { token: host.token }, NOW);

    const room = await store.get(key);
    assert.deepEqual(room?.moves, ["e2e4"], "the board was cleared by someone leaving");
    assert.equal(room?.seats.black, guest.token, "the other seat was released too");
  });
});

describe("abandoned seats", () => {
  test("a seat nobody has answered from can be taken", async () => {
    const { key } = await openRoom("white");
    assert.equal((await handleJoin(store, key, {}, NOW)).status, 409);

    // Long enough that both seats read as gone. This is the case that locked a player out
    // of their own game: the token proving the seat was theirs died with the closed tab.
    const later = NOW + AWAY_MS + 1_000;
    const back = await handleJoin(store, key, {}, later);
    assert.equal(back.status, 200, "an abandoned seat stayed claimed forever");
  });

  test("a seat still being polled from is not taken", async () => {
    const { key, host, guest } = await openRoom("white");
    const later = NOW + AWAY_MS + 1_000;
    // Both are still there and asking, which is what a seated player does every poll. The
    // abandonment window must never fire on someone whose only crime is a quiet game.
    await handlePoll(store, key, "white", later);
    await handlePoll(store, key, "black", later);

    const intruder = await handleJoin(store, key, { prefer: "white" }, later);
    assert.equal(intruder.status, 409, "a seat was taken from a player who was present");
    const room = await store.get(key);
    assert.equal(room?.seats.white, host.token);
    assert.equal(room?.seats.black, guest.token);
  });

  test("only the abandoned seat is offered, never the occupied one", async () => {
    const { key, host } = await openRoom("white");
    const later = NOW + AWAY_MS + 1_000;
    // White is present. Black stopped answering.
    await handlePoll(store, key, "white", later);

    const arrival = await handleJoin(store, key, { prefer: "white" }, later);
    assert.equal(arrival.status, 200);
    assert.equal(
      (arrival.body as JoinedBody).seat,
      "black",
      "a preference overrode a seated player",
    );
    assert.equal((await store.get(key))?.seats.white, host.token, "white was displaced");
  });

  test("an empty seat is preferred over an abandoned one", async () => {
    // A second player joining a fresh room must never displace the person who made it,
    // even once the creator's first heartbeat has aged out.
    const created = await handleCreate(store, { prefer: "white" }, NOW);
    const host = created.body as JoinedBody;
    const key = host.room.key;

    const later = NOW + AWAY_MS + 1_000;
    for (let i = 0; i < 8; i++) {
      const joined = await handleJoin(store, key, {}, later);
      assert.equal((joined.body as JoinedBody).seat, "black", "the creator was displaced");
      await handleLeave(store, key, { token: (joined.body as JoinedBody).token }, later);
    }
    assert.equal((await store.get(key))?.seats.white, host.token);
  });
});
