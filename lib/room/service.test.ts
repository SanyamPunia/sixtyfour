import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { startPosition } from "../chess/board.ts";
import { makeMove } from "../chess/make.ts";
import { fromUci, toUci } from "../chess/notation.ts";
import { legalMoves } from "../chess/rules.ts";
import { generateKey, isValidKey, KEY_LENGTH, normalizeKey } from "./key.ts";
import { MemoryRoomStore } from "./memory-store.ts";
import { AWAY_MS, HERE_MS, presenceOf } from "./presence.ts";
import type { Room, Seat } from "./protocol.ts";
import {
  createRoom,
  joinRoom,
  playMove,
  ROOM_CAP,
  rematch,
  replay,
  snapshot,
} from "./service.ts";

const NOW = 1_700_000_000_000;

/** Fool's mate. Four moves, and the fastest way to reach a finished game in a test. */
const FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"];

let store: MemoryRoomStore;
beforeEach(() => {
  store = new MemoryRoomStore();
});

/** Opens a room and lets the second seat be taken, which is the usual starting point. */
async function twoPlayerRoom(prefer: Seat = "white") {
  const created = await createRoom(store, { prefer, now: NOW });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("unreachable");
  const joined = await joinRoom(store, { key: created.room.key, now: NOW });
  assert.equal(joined.ok, true);
  if (!joined.ok) throw new Error("unreachable");
  return { key: created.room.key, host: created, guest: joined };
}

describe("keys", () => {
  test("generated keys are always valid and always the stated length", () => {
    for (let i = 0; i < 500; i++) {
      const key = generateKey();
      assert.equal(key.length, KEY_LENGTH);
      assert.equal(isValidKey(key), true, `rejected its own key: ${key}`);
    }
  });

  test("the confusable letters never appear", () => {
    // The whole reason for the reduced alphabet. A key with an O in it will be typed back
    // with a zero, and the player will be told the room does not exist.
    const thousand = Array.from({ length: 1000 }, generateKey).join("");
    for (const banned of ["0", "O", "1", "I", "L"]) {
      assert.equal(thousand.includes(banned), false, `${banned} appeared in a key`);
    }
  });

  test("keys spread across the alphabet rather than clustering", () => {
    // Guards the rejection sampling. A modulo would over-produce the first eight letters,
    // and this notices that without asserting an exact distribution.
    const counts = new Map<string, number>();
    for (const c of Array.from({ length: 4000 }, generateKey).join("")) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    assert.equal(counts.size, 31, "not every letter was reachable");
    const values = [...counts.values()];
    const expected = 24_000 / 31;
    assert.ok(
      Math.min(...values) > expected * 0.6 && Math.max(...values) < expected * 1.4,
      `letters were not evenly drawn: ${Math.min(...values)}..${Math.max(...values)}`,
    );
  });

  test("a typed key is forgiving about case, spaces and dashes", () => {
    assert.equal(normalizeKey(" k7m-2xq "), "K7M2XQ");
    assert.equal(isValidKey("k7m-2xq"), true);
  });

  test("wrong length and out-of-alphabet letters are refused", () => {
    assert.equal(isValidKey("K7M2X"), false);
    assert.equal(isValidKey("K7M2XQZ"), false);
    assert.equal(isValidKey("K7M2XO"), false);
    assert.equal(isValidKey(""), false);
  });
});

describe("uci", () => {
  test("every legal move from the start survives a round trip", () => {
    const position = startPosition();
    const moves = legalMoves(position);
    assert.equal(moves.length, 20);
    for (const move of moves) {
      const back = fromUci(position, toUci(move));
      assert.notEqual(back, null, `${toUci(move)} did not decode`);
      assert.equal(back?.from, move.from);
      assert.equal(back?.to, move.to);
    }
  });

  test("the four promotions are distinct on the wire", () => {
    const position = startPosition();
    for (const uci of ["a2a4", "b7b5", "a4b5", "b8c6", "b5b6", "c6d4", "b6b7", "d4e6"]) {
      const move = fromUci(position, uci);
      assert.notEqual(move, null, `setup move ${uci} was refused`);
      makeMove(position, move as NonNullable<typeof move>);
    }
    const promotions = ["b7a8q", "b7a8r", "b7a8b", "b7a8n"];
    const decoded = promotions.map((u) => fromUci(position, u));
    assert.equal(
      decoded.every((m) => m !== null),
      true,
      "a promotion failed to decode",
    );
    assert.equal(new Set(decoded.map((m) => m?.promo)).size, 4, "promotions collapsed");
    // The same two squares with no letter is the under-specified form, and there is no
    // sane default, so it must not resolve.
    assert.equal(fromUci(position, "b7a8"), null);
  });

  test("garbage and illegal moves both decode to null", () => {
    const position = startPosition();
    for (const bad of ["", "e2", "e2e4e4", "z9z9", "e2e5", "e7e5", "e2e4x"]) {
      assert.equal(fromUci(position, bad), null, `${bad} was accepted`);
    }
  });
});

describe("creating", () => {
  test("the creator is seated and holds a secret", async () => {
    const created = await createRoom(store, { prefer: "white", now: NOW });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.seat, "white");
    assert.equal(created.room.seats.white, created.token);
    assert.equal(created.room.seats.black, null);
    assert.equal(created.snapshot.version, 0);
    assert.deepEqual(created.snapshot.taken, { white: true, black: false });
  });

  test("a requested side is honoured", async () => {
    const black = await createRoom(store, { prefer: "black", now: NOW });
    assert.equal(black.ok && black.seat, "black");
  });

  test("a random side reaches both", async () => {
    const seats = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const made = await createRoom(new MemoryRoomStore(), { prefer: "random", now: NOW });
      if (made.ok) seats.add(made.seat);
    }
    assert.deepEqual([...seats].sort(), ["black", "white"]);
  });

  test("the cap refuses the room past the limit", async () => {
    for (let i = 0; i < ROOM_CAP; i++) {
      assert.equal((await createRoom(store, { now: NOW })).ok, true, `room ${i} refused`);
    }
    const over = await createRoom(store, { now: NOW });
    assert.equal(over.ok, false);
    assert.equal(over.ok === false && over.reason, "full");
    assert.equal(await store.activeCount(NOW), ROOM_CAP);
  });

  test("an expired room frees its slot", async () => {
    for (let i = 0; i < ROOM_CAP; i++) await createRoom(store, { now: NOW });
    const later = NOW + 25 * 60 * 60 * 1000;
    assert.equal(await store.activeCount(later), 0);
    assert.equal((await createRoom(store, { now: later })).ok, true);
  });

  test("simultaneous creates cannot exceed the cap", async () => {
    // Every one of these reads the count before any of them writes, which is exactly the
    // case a check-then-write in the service would wave through.
    const results = await Promise.all(
      Array.from({ length: 12 }, () => createRoom(store, { now: NOW })),
    );
    assert.equal(results.filter((r) => r.ok).length, ROOM_CAP);
    assert.equal(await store.activeCount(NOW), ROOM_CAP);
  });
});

describe("joining", () => {
  test("the second player takes the free seat", async () => {
    const { host, guest } = await twoPlayerRoom("white");
    assert.equal(guest.ok && guest.seat, "black");
    assert.equal(guest.ok && guest.fresh, true);
    assert.notEqual(guest.ok && guest.token, host.token);
    assert.deepEqual(guest.ok && guest.snapshot.taken, { white: true, black: true });
  });

  test("a reload keeps its own seat instead of consuming the other", async () => {
    const { key, host } = await twoPlayerRoom("white");
    const again = await joinRoom(store, { key, token: host.token, now: NOW });
    assert.equal(again.ok, true);
    assert.equal(again.ok && again.seat, "white");
    assert.equal(again.ok && again.token, host.token);
    // Nothing new happened, so nothing should be announced to the other player.
    assert.equal(again.ok && again.fresh, false);
  });

  test("a third player is refused", async () => {
    const { key } = await twoPlayerRoom();
    const third = await joinRoom(store, { key, now: NOW });
    assert.equal(third.ok, false);
    assert.equal(third.ok === false && third.reason, "full");
  });

  test("an unknown or expired key is not found", async () => {
    assert.equal((await joinRoom(store, { key: "ZZZZZZ", now: NOW })).ok, false);
    const { key } = await twoPlayerRoom();
    const late = await joinRoom(store, { key, now: NOW + ROOM_TTL_OVERSHOOT });
    assert.equal(late.ok === false && late.reason, "not-found");
  });

  test("two players opening one link at once get one seat each", async () => {
    const created = await createRoom(store, { prefer: "white", now: NOW });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const [a, b] = await Promise.all([
      joinRoom(store, { key: created.room.key, now: NOW }),
      joinRoom(store, { key: created.room.key, now: NOW }),
    ]);

    const winners = [a, b].filter((r) => r.ok);
    assert.equal(winners.length, 1, "both joins took the same seat");
    assert.equal([a, b].find((r) => !r.ok)?.ok === false, true);

    const room = (await store.get(created.room.key)) as Room;
    assert.notEqual(room.seats.black, null);
    assert.notEqual(room.seats.black, room.seats.white);
  });
});

const ROOM_TTL_OVERSHOOT = 25 * 60 * 60 * 1000;

describe("moving", () => {
  test("a legal move from the right seat is written", async () => {
    const { key, host } = await twoPlayerRoom("white");
    const result = await playMove(store, {
      key,
      token: host.token,
      uci: "e2e4",
      at: 1,
      now: NOW,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.snapshot.moves, ["e2e4"]);
    assert.equal(result.snapshot.version, 2);
    assert.equal(result.seat, "white");
  });

  test("the other player cannot move for you", async () => {
    const { key, guest } = await twoPlayerRoom("white");
    const result = await playMove(store, {
      key,
      token: guest.ok ? guest.token : "",
      uci: "e2e4",
      at: 1,
      now: NOW,
    });
    assert.equal(result.ok === false && result.reason, "not-your-turn");
  });

  test("a stranger with the key but no seat is refused", async () => {
    const { key } = await twoPlayerRoom("white");
    const result = await playMove(store, {
      key,
      token: "not-a-real-token",
      uci: "e2e4",
      at: 1,
      now: NOW,
    });
    assert.equal(result.ok === false && result.reason, "not-your-seat");
    assert.deepEqual((await store.get(key))?.moves, []);
  });

  test("an illegal move is refused and changes nothing", async () => {
    const { key, host } = await twoPlayerRoom("white");
    const result = await playMove(store, {
      key,
      token: host.token,
      uci: "e2e5",
      at: 1,
      now: NOW,
    });
    assert.equal(result.ok === false && result.reason, "illegal");
    const room = (await store.get(key)) as Room;
    assert.deepEqual(room.moves, []);
    assert.equal(room.version, 1, "a refused move still bumped the version");
  });

  test("a player who missed two moves is told they are behind, not that it is not their turn", async () => {
    const { key, host, guest } = await twoPlayerRoom("white");
    await playMove(store, { key, token: host.token, uci: "e2e4", at: 1, now: NOW });
    await playMove(store, {
      key,
      token: guest.ok ? guest.token : "",
      uci: "e7e5",
      at: 2,
      now: NOW,
    });

    // It really is White's turn again, and d2d4 really is legal, so every check except the
    // version one would wave this through against a board White never saw.
    const stale = await playMove(store, {
      key,
      token: host.token,
      uci: "d2d4",
      at: 1,
      now: NOW,
    });
    assert.equal(stale.ok === false && stale.reason, "stale");
    assert.equal(stale.ok === false && stale.snapshot?.version, 3);
    assert.deepEqual((await store.get(key))?.moves, ["e2e4", "e7e5"]);
  });

  test("two moves racing one version write exactly one", async () => {
    const { key, host } = await twoPlayerRoom("white");

    // Hold the first swap open so the second read happens before either write. Without
    // this the two calls run to completion one after the other and never actually race.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    store.onBeforeSwap = async () => {
      if (held) return;
      held = true;
      await gate;
    };

    const both = Promise.all([
      playMove(store, { key, token: host.token, uci: "e2e4", at: 1, now: NOW }),
      playMove(store, { key, token: host.token, uci: "d2d4", at: 1, now: NOW }),
    ]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    const [a, b] = await both;

    assert.equal([a, b].filter((r) => r.ok).length, 1, "both moves were written");
    const loser = [a, b].find((r) => !r.ok);
    assert.equal(loser?.ok === false && loser.reason, "stale");

    const room = (await store.get(key)) as Room;
    assert.equal(room.moves.length, 1, "the board took two moves from one turn");
    assert.equal(room.version, 2);
  });

  test("a finished game accepts nothing further", async () => {
    const { key, host, guest } = await twoPlayerRoom("white");
    const tokens = { white: host.token, black: guest.ok ? guest.token : "" };

    let at = 1;
    for (const [index, uci] of FOOLS_MATE.entries()) {
      const seat: Seat = index % 2 === 0 ? "white" : "black";
      const result = await playMove(store, { key, token: tokens[seat], uci, at, now: NOW });
      assert.equal(result.ok, true, `${uci} was refused`);
      at += 1;
    }

    const room = (await store.get(key)) as Room;
    assert.equal(replay(room.moves)?.status, "checkmate");

    const after = await playMove(store, {
      key,
      token: tokens.white,
      uci: "g1f3",
      at,
      now: NOW,
    });
    assert.equal(after.ok === false && after.reason, "game-over");
  });

  test("a move refreshes the room's expiry", async () => {
    const { key, host } = await twoPlayerRoom("white");
    const before = ((await store.get(key)) as Room).expiresAt;
    const later = NOW + 60_000;
    await playMove(store, { key, token: host.token, uci: "e2e4", at: 1, now: later });
    assert.equal(((await store.get(key)) as Room).expiresAt, later + (before - NOW));
  });
});

describe("rematch", () => {
  test("is refused while the game is live", async () => {
    const { key, host } = await twoPlayerRoom("white");
    await playMove(store, { key, token: host.token, uci: "e2e4", at: 1, now: NOW });
    const result = await rematch(store, { key, token: host.token, now: NOW });
    assert.equal(result.ok, false);
    assert.deepEqual(((await store.get(key)) as Room).moves, ["e2e4"]);
  });

  test("clears the board once the game is over and keeps both seats", async () => {
    const { key, host, guest } = await twoPlayerRoom("white");
    const tokens = { white: host.token, black: guest.ok ? guest.token : "" };
    let at = 1;
    for (const [index, uci] of FOOLS_MATE.entries()) {
      await playMove(store, {
        key,
        token: tokens[index % 2 === 0 ? "white" : "black"],
        uci,
        at,
        now: NOW,
      });
      at += 1;
    }

    const result = await rematch(store, { key, token: host.token, now: NOW });
    assert.equal(result.ok, true);
    const room = (await store.get(key)) as Room;
    assert.deepEqual(room.moves, []);
    assert.equal(room.seats.white, tokens.white);
    assert.equal(room.seats.black, tokens.black);
    assert.equal(replay(room.moves)?.status, "playing");
  });
});

describe("secrets", () => {
  test("no snapshot ever carries a seat token", async () => {
    const { key, host, guest } = await twoPlayerRoom("white");
    const guestToken = guest.ok ? guest.token : "";
    const move = await playMove(store, {
      key,
      token: host.token,
      uci: "e2e4",
      at: 1,
      now: NOW,
    });

    const room = (await store.get(key)) as Room;
    const views = [
      host.snapshot,
      guest.ok ? guest.snapshot : null,
      move.ok ? move.snapshot : move.snapshot,
      snapshot(room, "playing"),
    ];

    for (const view of views) {
      const text = JSON.stringify(view);
      assert.equal(text.includes(host.token), false, "a snapshot leaked the white token");
      assert.equal(text.includes(guestToken), false, "a snapshot leaked the black token");
    }
  });
});

describe("presence", () => {
  test("a fresh heartbeat reads as here", () => {
    assert.equal(presenceOf(NOW, NOW), "here");
    assert.equal(presenceOf(NOW - HERE_MS + 1, NOW), "here");
  });

  test("a stale heartbeat reads as away before it reads as gone", () => {
    assert.equal(presenceOf(NOW - HERE_MS - 1, NOW), "away");
    assert.equal(presenceOf(NOW - AWAY_MS + 1, NOW), "away");
    assert.equal(presenceOf(NOW - AWAY_MS - 1, NOW), "gone");
  });

  test("a seat never seen is gone", () => {
    assert.equal(presenceOf(null, NOW), "gone");
  });

  test("the store reports both seats independently", async () => {
    const { key } = await twoPlayerRoom();
    await store.touch(key, "white", NOW);
    assert.deepEqual(await store.presence(key, NOW), { white: "here", black: "gone" });
    await store.touch(key, "black", NOW - AWAY_MS - 1);
    assert.deepEqual(await store.presence(key, NOW), { white: "here", black: "gone" });
    await store.touch(key, "black", NOW - HERE_MS - 1);
    assert.deepEqual(await store.presence(key, NOW), { white: "here", black: "away" });
  });
});
