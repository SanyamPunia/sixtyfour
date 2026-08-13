# Rooms, plan

Play a friend. One player creates a room, shares a link or a six character key, the other
joins, and both see whether the other is actually there.

This is the plan of record for the feature. `PLAN.md` covers what is already built.

Nothing here is implemented yet. Section 9 is the order to build it in.

---

## 1. What this changes

Today the product has no backend. The page is statically prerendered, the engine and the
bot run in the browser, and nothing is stored anywhere. Rooms break all three of those.

Three things follow, and they are the real cost of the feature:

- **It starts costing money to run.** Every room is server time and a data store.
- **It can fail in ways nothing here currently can.** A network drops, a room expires, two
  tabs disagree. Every one of those needs a visible state.
- **It adds UI to a product whose whole point is not having any.** Section 7 is the budget.

---

## 2. Transport, and why not WebSockets

Vercel Functions serve WebSockets natively now, so a third party realtime service is not
needed. Two things in the platform documentation decide against them anyway.

**New connections are not guaranteed to reach the same function instance.** Two players in
one room can land on different instances, which cannot see each other's memory. A shared
store is required whichever transport is chosen, so WebSockets do not save that work.

**A connection closes when the function reaches its maximum duration**, 300 seconds by
default. A chess game routinely runs longer than five minutes, so with WebSockets every
game would drop and reconnect several times as normal behaviour. The feature being asked
for is a truthful "is the other person there" indicator, and a transport that disconnects
healthy players every five minutes actively works against it: the indicator would have to
learn to ignore its own transport.

**So: short polling against a shared store.** Chess is turn based. A move happens every few
seconds at most, and this product already holds the bot back for 1200ms deliberately
because an instant reply reads as a glitch. A poll every 1.5 seconds is imperceptible here.

| | Polling | WebSocket |
|---|---|---|
| Move latency | up to 1.5s | immediate |
| Survives a long game | yes | reconnects every 300s |
| Presence signal | a heartbeat timestamp, which means what it says | connection state, muddied by forced reconnects |
| Shared store needed | yes | yes |
| Cost shape | many tiny requests | function held open for the whole game |
| Failure modes | one: the request fails | connect, drop, reconnect, resubscribe, resync |

Polling is the smaller thing that answers the actual requirement. WebSockets stay a
reasonable future swap, which is why section 4 puts the transport behind one interface.

**Provisioning the store goes through the Vercel Marketplace**, not a hardcoded vendor.
That is step 0 in section 9. The shape needed is a key value store with expiry and atomic
compare and set. Redis fits, but the provider is chosen by running the marketplace flow,
not by picking one here.

---

## 3. Authority

**The server validates every move.** Not the clients.

This is nearly free, and it is the single best property the existing architecture hands us:
`lib/chess` is pure TypeScript with no React and no browser API. The same engine that has
passed perft to depth 5 runs unchanged in a function. There is no second implementation to
keep in step, which is the usual reason server-authoritative multiplayer is expensive.

A move arrives as coordinates. The server loads the room, checks the sender owns the side
to move, generates the legal moves for that position, and rejects anything not in the list.
A client cannot put an illegal position on the board even if it tries.

---

## 4. Shape

```
lib/room/
  key.ts            generate and validate a room key
  protocol.ts       the request and response types, shared by client and server
  store.ts          the store interface, and the one implementation
  service.ts        create, join, move, poll. Pure logic over the store
  service.test.ts
app/api/room/
  route.ts                POST, create a room
  [key]/route.ts          GET, poll. POST, join
  [key]/move/route.ts     POST, submit a move
components/game/
  use-room.ts       the client half: poll, submit, reconnect
  room-button.tsx   opens the dialog
  room-dialog.tsx   create or join
  presence-dot.tsx  is the other player there
```

`lib/room/` holds no React, like `lib/chess` and `lib/bot`, so `node --test` can reach the
service directly. The store sits behind an interface so the polling transport and the store
can each be swapped without touching the service.

### Room state

```ts
interface Room {
  key: string;
  fen: string;            // the position, which the engine can already read and write
  version: number;        // bumped on every change, and what polling compares
  history: string[];      // moves in SAN, for a reconnecting client to catch up
  players: {
    white: { id: string; lastSeen: number } | null;
    black: { id: string; lastSeen: number } | null;
  };
  createdAt: number;
  status: "waiting" | "playing" | "finished";
}
```

FEN rather than a move list as the source of truth, because the engine already round trips
it and a reconnecting client needs one value, not a replay.

---

## 5. The key

Six characters from a 31 character alphabet: the digits and letters minus `0`, `O`, `1`,
`I` and `L`, which are the pairs people confuse when reading a key aloud or typing it from
a screenshot.

That is about 887 million keys. Rooms expire, so the live set is tiny and guessing one is
not a practical attack. It is short enough to say over the phone, which is the point.

Two ways in, both landing in the same place:

- A link, `sixtyfour-liart.vercel.app/?room=K7M2QX`
- Typing the key, for when the link arrives as a screenshot or over the phone

---

## 6. Presence, which is the actual feature

"Is the other person there" is what was asked for, and it is the part most easily done
badly. Presence is a **heartbeat**, not a connection.

Every poll writes `lastSeen` for the caller. The opponent is:

| | |
|---|---|
| **here** | seen within 5 seconds |
| **away** | seen within 45 seconds, so probably a tab switch or a brief network drop |
| **gone** | not seen for 45 seconds |

Three states, not two, and the middle one matters. A player who locks their phone for
fifteen seconds has not left, and telling their opponent they have is worse than saying
nothing. Browsers also throttle timers in background tabs, so a backgrounded tab will
naturally look away and must not be reported as gone.

Shown as a second dot beside the turn dot, in the same language the board already speaks:
solid when here, hollow when away, faded when gone, with a tooltip naming it. No new
vocabulary, no banner, no toast.

---

## 7. UI budget

The product has five controls and no text during a game. Rooms must not double that.

**One new control.** A two person icon beside the others. It opens one dialog with two
choices: create a room, or join with a key. That dialog is the entire new surface.

**After creating**, the dialog shows the key large enough to read across a desk, a copy
button for the link, and "waiting for someone to join". It closes itself when they do.

**In a room, the difficulty control is hidden.** There is no bot to configure. The side
control is hidden too, because sides are assigned when the room is made.

**New game becomes a rematch offer**, because one player cannot restart a shared game
alone. It asks, the other accepts, and only then does the board reset.

Everything else stays. The status line, the turn dot, the material readout and the result
all work unchanged, because none of them care where the moves came from.

---

## 8. What can go wrong, and what it looks like

Each of these needs a state, and none of them can be silent.

| | What the player sees |
|---|---|
| Room key does not exist | The dialog says so and stays open. It is almost always a typo. |
| Room is full | Same. Two people already hold the sides. |
| Room expired | Same, with the reason, since the link may be days old. |
| Opponent has not joined yet | "waiting for someone to join", with the key still visible |
| Opponent goes away | The presence dot goes hollow. Nothing else changes. |
| Opponent is gone | The dot fades. The board stays as it is, because they may come back. |
| Your own network drops | Polling backs off and retries. Your dot is what the opponent sees. |
| You refresh | You rejoin as the same player, from `localStorage`, and the board is restored |
| Two tabs, same player | The later one wins the identity and the earlier goes read only |
| Server rejects a move | The piece returns and the board resyncs from the server's position |

That last row is the one to get right. The client applies a move optimistically because
waiting 1.5 seconds to see your own piece move would be unbearable. If the server disagrees
the position snaps back to the server's, which is authoritative. The reducer already has the
piece identity model that makes such a snap animate rather than jump.

---

## 9. Order of work

Each step ends somewhere testable.

**0. Provision the store.** Run the Vercel Marketplace flow and pick a key value store with
expiry and compare and set. Do not hardcode a vendor before this.

**1. `lib/room/` with an in-memory store.** Key generation, the protocol types, and the
service: create, join, move, poll. Full unit tests against the in-memory store, including
an illegal move, a move out of turn, a move by a player who is not in the room, and two
moves racing on the same version.
*Exit: the service is correct with no network and no provider involved.*

**2. Swap in the real store.** The service does not change. Only the implementation behind
the interface does.
*Exit: the same test suite passes against the provisioned store.*

**3. The API routes.** Thin. Parse, call the service, shape the response. Rate limited per
IP on create and join, because a room key is short and creation is unauthenticated.
*Exit: a room can be driven end to end with `curl`.*

**4. `use-room.ts`.** Polling with backoff, optimistic local moves, resync on rejection,
identity in `localStorage`. This is where the real difficulty is, not in the server.
*Exit: two browser tabs play a full game.*

**5. The dialog and the presence dot.** Section 7's budget is the constraint.
*Exit: the flow works from a shared link and from a typed key.*

**6. Two-page browser verification.** `scripts/verify.mjs` drives one page today. Rooms
need two talking to each other, which puppeteer supports directly.
*Exit: the checks in section 10 pass.*

---

## 10. How it gets verified

The existing suite drives one page. Rooms need two, and the interesting failures are all
about what the second page sees.

- Page A creates a room. Page B joins with the key. Both report the same position.
- A move on A appears on B within the poll interval.
- A move out of turn is rejected and the board does not change.
- An illegal move posted directly to the API is rejected, and the room's position is
  unchanged afterwards.
- Closing page B moves A's presence dot to away, then to gone, on the timings in section 6.
- Reopening B rejoins as the same player, with the position intact.
- A room key that does not exist gives a visible error and no navigation.
- Backgrounding a tab does not report that player as gone.

The last two are the ones a manual test never catches.

---

## 11. Open questions

1. **Who picks sides?** Simplest is that the creator picks white, black, or random when
   making the room. The alternative, deciding when the second player joins, needs another
   round trip and another state.
2. **How long does a room live?** A day is a lot for a game that lasts twenty minutes, and
   too short for "let's finish this tomorrow". Suggest 24 hours, refreshed on every move.
3. **Should a finished room allow a rematch, or force a new key?** A rematch is friendlier.
   A new key is simpler and makes the state machine smaller.
4. **Is there a clock?** Not proposed. It is a separate feature with its own failure modes
   around disconnects, and it would need the server to be the timekeeper.
5. **Spectators?** Not proposed. It changes the room from two slots to an audience.

---

## 12. Out of scope

Accounts, matchmaking against strangers, ratings, chat, saved game history, tournaments.
Every one of them turns a small game you send to a friend into a service that needs
moderation.
