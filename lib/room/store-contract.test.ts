/**
 * One suite, run against every store.
 *
 * The service is only correct if the thing underneath it keeps the promises in `store.ts`,
 * and the in-memory store keeps them trivially because it never yields in the middle of an
 * operation. Redis has a network in the way, so the same assertions are worth far more
 * there. Running one suite against both is what makes the fast store a real stand-in
 * rather than a hopeful one.
 *
 * The Redis half is skipped, not failed, when there is no connection string. A checkout
 * with no credentials still has a meaningful `pnpm test`.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { MemoryRoomStore } from "./memory-store.ts";
import { AWAY_MS, HERE_MS } from "./presence.ts";
import type { Room } from "./protocol.ts";
import { RedisRoomStore } from "./redis-store.ts";
import { createRoom, joinRoom, playMove, ROOM_CAP } from "./service.ts";
import type { RoomStore } from "./store.ts";

/**
 * Anchored to the real clock, an hour ahead.
 *
 * The service takes `now` as an argument and can be told any time at all, but Redis cannot:
 * an expiry is an absolute wall-clock instant. A fixed constant from a past date makes
 * every key expire the moment it is written, and the in-memory store hides that completely
 * because it compares against the same made-up time.
 */
const NOW = Date.now() + 60 * 60 * 1000;
const REDIS_URL = process.env.REDIS_URL ?? "";

function room(key: string, version = 0, moves: string[] = []): Room {
  return {
    key,
    version,
    moves,
    seats: { white: "w-secret", black: null },
    resigned: null,
    createdAt: NOW,
    expiresAt: NOW + 60_000,
  };
}

/** Every promise `store.ts` makes, stated once. */
function contract(
  name: string,
  get: () => RoomStore,
  reset: () => Promise<void>,
  options: { skip?: string } = {},
) {
  const opts = options.skip === undefined ? {} : { skip: options.skip };

  describe(`${name} store`, () => {
    // Emptied between tests. The cap is global by design, so one test that fills it would
    // otherwise make every test after it fail for a reason that has nothing to do with it.
    beforeEach(async () => {
      if (options.skip === undefined) await reset();
    });

    test("a created room reads back exactly", opts, async () => {
      const store = get();
      const key = `C${randomUUID().slice(0, 5).toUpperCase()}`;
      assert.equal(await store.create(room(key), ROOM_CAP), "created");
      const read = await store.get(key);
      assert.deepEqual(read, room(key));
    });

    test("an unknown key reads as null", opts, async () => {
      assert.equal(await get().get(`MISS${randomUUID().slice(0, 2)}`), null);
    });

    test("a stored room is a copy, not a handle", opts, async () => {
      // The Redis store serialises, so a caller there can never reach stored state. The
      // memory store has to imitate that or a test can pass on a mutation production
      // cannot perform.
      const store = get();
      const key = `H${randomUUID().slice(0, 5).toUpperCase()}`;
      await store.create(room(key), ROOM_CAP);
      const first = (await store.get(key)) as Room;
      first.moves.push("e2e4");
      first.version = 99;
      const second = (await store.get(key)) as Room;
      assert.deepEqual(second.moves, []);
      assert.equal(second.version, 0);
    });

    test("creating the same key twice reports the second as existing", opts, async () => {
      const store = get();
      const key = `D${randomUUID().slice(0, 5).toUpperCase()}`;
      assert.equal(await store.create(room(key), ROOM_CAP), "created");
      assert.equal(await store.create(room(key), ROOM_CAP), "exists");
    });

    test("the cap admits exactly its limit and then refuses", opts, async () => {
      const store = get();
      const cap = 3;
      for (let i = 0; i < cap; i++) {
        const key = `E${i}${randomUUID().slice(0, 4).toUpperCase()}`;
        assert.equal(await store.create(room(key), cap), "created", `room ${i} refused`);
      }
      const over = `E9${randomUUID().slice(0, 4).toUpperCase()}`;
      assert.equal(await store.create(room(over), cap), "full");
      assert.equal(await store.get(over), null, "a refused room was written anyway");
      assert.equal(await store.activeCount(NOW), cap);
    });

    test("a swap writes only against the version it expects", opts, async () => {
      const store = get();
      const key = `S${randomUUID().slice(0, 5).toUpperCase()}`;
      await store.create(room(key), ROOM_CAP);

      assert.equal(await store.swap(room(key, 1, ["e2e4"]), 7), false, "wrong version wrote");
      assert.deepEqual((await store.get(key))?.moves, []);

      assert.equal(await store.swap(room(key, 1, ["e2e4"]), 0), true);
      assert.equal((await store.get(key))?.version, 1);

      // The version the caller just used is now spent, so replaying it must not write.
      assert.equal(await store.swap(room(key, 2, ["d2d4"]), 0), false);
      assert.deepEqual((await store.get(key))?.moves, ["e2e4"]);
    });

    test("a swap against a room that is gone does not recreate it", opts, async () => {
      const store = get();
      const key = `G${randomUUID().slice(0, 5).toUpperCase()}`;
      assert.equal(await store.swap(room(key, 1), 0), false);
      assert.equal(await store.get(key), null);
    });

    test("removing takes the room out of the count", opts, async () => {
      const store = get();
      const key = `R${randomUUID().slice(0, 5).toUpperCase()}`;
      await store.create(room(key), ROOM_CAP);
      const before = await store.activeCount(NOW);
      await store.remove(key);
      assert.equal(await store.get(key), null);
      assert.equal(await store.activeCount(NOW), before - 1);
    });

    test("a lease can be pushed back without touching the room", opts, async () => {
      // The version has to stay put: a client holds it to send its next move against, so
      // moving it because somebody's tab is open would refuse a move that was never stale.
      const store = get();
      const key = `L${randomUUID().slice(0, 5).toUpperCase()}`;
      await store.create(room(key, 3, ["e2e4"]), ROOM_CAP);

      const later = NOW + 120_000;
      assert.equal(await store.activeCount(later), 0, "it should have lapsed by then");

      await store.create(room(key, 3, ["e2e4"]), ROOM_CAP);
      await store.extend(key, later + 60_000);
      assert.equal(await store.activeCount(later), 1, "the lease did not move");

      const read = await store.get(key);
      assert.equal(read?.version, 3, "extending changed the version");
      assert.deepEqual(read?.moves, ["e2e4"], "extending changed the board");
    });

    test("hits accumulate inside a window and start their own clock", opts, async () => {
      const store = get();
      const bucket = `B${randomUUID().slice(0, 6)}`;
      assert.equal(await store.hits(bucket, 60_000), 1);
      assert.equal(await store.hits(bucket, 60_000), 2);
      assert.equal(await store.hits(bucket, 60_000), 3);
      // A different bucket is a different caller and counts separately.
      assert.equal(await store.hits(`${bucket}x`, 60_000), 1);
    });

    test("an expired room stops counting", opts, async () => {
      const store = get();
      const key = `X${randomUUID().slice(0, 5).toUpperCase()}`;
      await store.create(room(key), ROOM_CAP);
      assert.equal(await store.activeCount(NOW + 120_000), 0);
    });

    test("presence ages from here to away to gone", opts, async () => {
      const store = get();
      const key = `P${randomUUID().slice(0, 5).toUpperCase()}`;
      assert.deepEqual(await store.presence(key, NOW), { white: "gone", black: "gone" });

      await store.touch(key, "white", NOW);
      assert.deepEqual(await store.presence(key, NOW), { white: "here", black: "gone" });
      assert.equal((await store.presence(key, NOW + HERE_MS + 1)).white, "away");
      assert.equal((await store.presence(key, NOW + AWAY_MS + 1)).white, "gone");

      await store.touch(key, "black", NOW);
      assert.deepEqual(await store.presence(key, NOW), { white: "here", black: "here" });
    });

    test("the join race resolves to one seat", opts, async () => {
      const store = get();
      const created = await createRoom(store, { prefer: "white", now: NOW });
      assert.equal(created.ok, true);
      if (!created.ok) return;

      const results = await Promise.all([
        joinRoom(store, { key: created.room.key, now: NOW }),
        joinRoom(store, { key: created.room.key, now: NOW }),
        joinRoom(store, { key: created.room.key, now: NOW }),
      ]);
      assert.equal(results.filter((r) => r.ok).length, 1, "the seat went to more than one");

      const stored = (await store.get(created.room.key)) as Room;
      assert.notEqual(stored.seats.black, null);
      assert.notEqual(stored.seats.black, stored.seats.white);
    });

    test("the move race writes one move", opts, async () => {
      const store = get();
      const created = await createRoom(store, { prefer: "white", now: NOW });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const key = created.room.key;
      await joinRoom(store, { key, now: NOW });

      const results = await Promise.all([
        playMove(store, { key, token: created.token, uci: "e2e4", at: 1, now: NOW }),
        playMove(store, { key, token: created.token, uci: "d2d4", at: 1, now: NOW }),
        playMove(store, { key, token: created.token, uci: "g1f3", at: 1, now: NOW }),
      ]);

      assert.equal(results.filter((r) => r.ok).length, 1, "more than one move was written");
      const stored = (await store.get(key)) as Room;
      assert.equal(stored.moves.length, 1);
      assert.equal(stored.version, 2);
    });
  });
}

const memory = new MemoryRoomStore();
contract(
  "memory",
  () => memory,
  () => memory.close(),
);

let redis: RedisRoomStore | null = null;
if (REDIS_URL !== "") {
  before(() => {
    // A prefix per run, so a suite that fills the cap and expires rooms cannot disturb a
    // real game, and two runs at once do not collide.
    redis = new RedisRoomStore(REDIS_URL, { prefix: `test:${randomUUID().slice(0, 8)}:` });
  });
  after(async () => {
    await redis?.drop();
    await redis?.close();
  });
}
contract(
  "redis",
  () => redis as RoomStore,
  async () => {
    await redis?.drop();
  },
  { ...(REDIS_URL === "" ? { skip: "no REDIS_URL, skipping the live store" } : {}) },
);
