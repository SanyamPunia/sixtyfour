# Rooms, plan

Play a friend. One player creates a room, shares a link or a six character key, the other
joins, and both see whether the other is actually there.

This is the plan of record for the feature. `PLAN.md` covers what is already built.

Nothing here is implemented yet. Section 10 is the order to build it in.

---

## 1. What this changes

Today the product has no backend. The page is statically prerendered, the engine and the
bot run in the browser, and nothing is stored anywhere. Rooms break all three.

Three things follow, and they are the real cost of the feature:

- **It starts costing money to run.** Section 3 caps that at a number rather than leaving it
  open ended.
- **It can fail in ways nothing here currently can.** A network drops, a room expires, two
  tabs disagree, a laptop sleeps mid game. Every one of those needs a visible state.
- **It adds UI to a product whose whole point is not having any.** Section 8 is the budget.

---

## 2. Transport: WebSockets

Vercel Functions serve WebSockets natively, so no third party realtime service is needed.

Moves arrive the instant they are played. Nothing about this product tolerates a move
appearing a second and a half after it was made: the whole board is tuned at the scale of
a 190ms slide and a 140ms lift, and a delay an order of magnitude larger than that would be
the slowest thing on screen by a wide margin. Presence is also better served, because a tab
closing produces a `close` event immediately rather than a heartbeat quietly going stale.

Two facts from the platform shape the design, and neither is a reason to avoid WebSockets.
They are a reason to build two specific things.

### A shared store is required regardless

A single connection is pinned to one function instance, but **new connections are not
guaranteed to reach the same one**. Two players in a room routinely land on different
instances, which cannot see each other's memory.

So a move from one player reaches the other by going through the store, not by one socket
writing to another:

```
A's socket  ->  instance 1  ->  validate, write state, PUBLISH room:{key}
                                            |
                                     Redis pub/sub
                                            |
                B's socket  <-  instance 2  <-  SUBSCRIBE room:{key}
```

**This makes pub/sub a hard requirement on the store, not just key value with expiry.**

### The store: Upstash Redis, over TCP

Upstash supports pub/sub, so it fits. There is one catch, and it is the single easiest
thing to get wrong here.

**Upstash's REST API cannot `SUBSCRIBE`.** It is request and response, and a subscriber
needs a held connection. `@upstash/redis`, the HTTP SDK, exists for edge runtimes such as
Cloudflare Workers where TCP is unavailable, and it is the wrong client for this.

Use the native protocol instead: `ioredis` against the `rediss://` endpoint. Vercel
Functions on Fluid Compute are Node.js with full TCP, so the reason the HTTP SDK exists does
not apply to us.

```
PUBLISH   works over either. It is fire and forget
SUBSCRIBE needs the TCP endpoint. This decides the client
```

Two consequences worth planning for:

- **One subscriber connection per function instance, not per player.** Fluid Compute reuses
  instances, so a subscriber survives across invocations and is shared by every room that
  instance is serving. Subscribe per room key and unsubscribe when the last local socket for
  that room closes, or instances slowly accumulate dead subscriptions.
- **`ioredis` is a new runtime dependency**, and the first in this project that is not UI.
  `CLAUDE.md` lists the runtime dependencies and says adding one needs a reason in that
  table. This is the reason, and that table gets updated when this ships.

### The connection dies every five minutes, and that is fine

A connection closes when the function reaches its maximum duration, 300 seconds by default.
A chess game routinely runs longer, so **a healthy game will reconnect several times**. That
is normal, not an error, and the client reconnects with backoff.

The only thing it must not do is show up as "your opponent left". Section 7 handles that
with a grace window: a socket that closes and comes back inside a few seconds never changes
what the other player sees. Getting this wrong is what makes multiplayer feel broken, so it
is called out here rather than left to the presence code to discover.

### Polling is the fallback, not the design

Some networks block WebSocket upgrades. If the socket cannot establish after a few
attempts, the client falls back to polling the same room endpoint every 1.5 seconds. It is
worse, and it is much better than a blank screen. The transport sits behind one interface
so the fallback is a swap rather than a second implementation of the game.

---

## 3. Capacity: five rooms

**At most five rooms exist at once, globally.** A sixth create attempt is refused with a
message saying so.

This is a deliberate ceiling rather than a scaling strategy. The feature is "send a link to
a friend", not a public service, and an uncapped room count on a personal project is an open
invitation to pay for someone else's traffic. Five is enough for the intended use and small
enough that the bill cannot surprise anyone.

Held as a sorted set scored by expiry, so it prunes itself:

```
ZREMRANGEBYSCORE rooms:active 0 <now>    drop what has expired
ZCARD            rooms:active            how many are live
ZADD             rooms:active <expiry> <key>
```

Those three run as one atomic script, or the check and the add race each other and six
rooms exist. Refusing must be explicit in the dialog: "all rooms are in use, try again in a
few minutes" is honest and actionable. Silence or a spinner is not.

Rate limiting on create and join sits alongside it, keyed by IP, because a room key is six
characters and creation needs no account.

---

## 4. Authority

**The server validates every move.** Not the clients.

This is nearly free, and it is the best property the existing architecture hands us:
`lib/chess` is pure TypeScript with no React and no browser API. The engine that has passed
perft to depth 5 runs unchanged inside a function. There is no second implementation to keep
in step, which is the usual reason server authoritative multiplayer is expensive.

A move arrives as coordinates. The server loads the room, checks the sender owns the side to
move, generates the legal moves for that position, and rejects anything not in the list. A
client cannot put an illegal position on the board even if it tries.

---

## 5. Shape

```
lib/room/
  key.ts            generate and validate a room key
  protocol.ts       every message either side can send, shared by client and server
  store.ts          the store interface: state, atomic swap, pub/sub, the room cap
  service.ts        create, join, move, leave. Pure logic over the store
  service.test.ts
app/api/room/
  route.ts                POST, create a room
  [key]/ws/route.ts       the WebSocket, via experimental_upgradeWebSocket
  [key]/route.ts          GET, the polling fallback. POST, join
components/game/
  use-room.ts       the client half: connect, reconnect, send, reconcile
  room-transport.ts the socket, its backoff, and the polling fallback behind one interface
  room-button.tsx   opens the dialog
  room-dialog.tsx   create or join
  presence-dot.tsx  is the other player there
```

`lib/room/` holds no React, like `lib/chess` and `lib/bot`, so `node --test` reaches the
service directly with no network and no provider.

### Room state

```ts
interface Room {
  key: string;
  fen: string;            // the position. The engine already reads and writes this
  version: number;        // bumped on every change. Every message carries it
  history: string[];      // SAN, so a reconnecting client can catch up without a replay
  players: {
    white: { id: string; connectedAt: number; lastSeen: number } | null;
    black: { id: string; connectedAt: number; lastSeen: number } | null;
  };
  expiresAt: number;
  status: "waiting" | "playing" | "finished";
}
```

FEN as the source of truth rather than a move list, because the engine round trips it
already and a reconnecting client needs one value rather than a replay.

`version` is what makes reconnection cheap. The client says where it is, and the server
either says "you are current" or sends the position.

---

## 6. The key

Six characters from a 31 character alphabet: digits and letters minus `0`, `O`, `1`, `I` and
`L`, which are the pairs people confuse reading a key aloud or typing it from a screenshot.

About 887 million keys, and at most five live at any moment, so guessing one is not a
practical attack. Short enough to say over the phone, which is the point.

Two ways in, landing in the same place:

- A link, `sixtyfour-liart.vercel.app/?room=K7M2QX`
- Typing the key, for when the link arrives as a screenshot or over the phone

---

## 7. Presence, which is the actual feature

"Is the other person there" is what was asked for, and it is the part most easily done
badly. Two signals, because neither is sufficient alone.

**The socket says so.** A `close` event fires the moment a tab shuts. That is the fast,
definite signal, and it is why WebSockets are worth the reconnection work.

**A heartbeat catches what the socket misses.** A laptop that sleeps or a network that
disappears leaves a half open connection: the server still believes the socket is alive and
no `close` ever arrives. A ping every 10 seconds, with `lastSeen` recorded, catches it.

Three states, and the middle one is the whole point:

| | |
|---|---|
| **here** | connected, or seen within 5 seconds |
| **away** | disconnected less than 20 seconds ago, or last seen within 45 |
| **gone** | neither |

**The grace window is what makes this honest.** The connection dies every five minutes by
design, so a close event on its own means nothing. A player who disconnects and returns
inside 20 seconds never appears to have left, which covers both the routine 300 second
reconnect and a phone locked for a moment. Report those as gone and the indicator becomes
noise that people learn to ignore, which is worse than not having it.

Shown as a second dot beside the turn dot, in the language the board already speaks: solid
when here, hollow when away, faded when gone, with a tooltip naming it. No banner, no toast,
no new vocabulary.

---

## 8. UI budget

The product has five controls and no text during a game. Rooms must not double that.

**One new control.** A two person icon beside the others, opening one dialog with two
choices: create a room, or join with a key. That dialog is the entire new surface.

**After creating**, the dialog shows the key large enough to read across a desk, a copy
button for the link, and "waiting for someone to join". It closes itself when they arrive.

**In a room, the difficulty and side controls hide.** There is no bot to configure and sides
are settled when the room is made.

**New game becomes a rematch offer**, because one player cannot restart a shared game alone.
It asks, the other accepts, and only then does the board reset.

Everything else stays. The status line, the turn dot, the material readout and the result
all work unchanged, because none of them care where a move came from.

---

## 9. What can go wrong, and what it looks like

Each needs a state, and none can be silent.

| | What the player sees |
|---|---|
| All five rooms are in use | The dialog says so and stays open, with the reason |
| Room key does not exist | The dialog says so. It is almost always a typo |
| Room is full | Same. Two people already hold the sides |
| Room expired | Same, with the reason, since the link may be days old |
| Opponent has not joined | "waiting for someone to join", key still visible |
| The socket drops routinely | Nothing. This is the 300 second reconnect and it is invisible |
| Opponent goes away | The presence dot goes hollow after the grace window, not before |
| Opponent is gone | The dot fades. The board stays, because they may come back |
| WebSocket blocked entirely | Falls back to polling after a few failed attempts. Nothing else changes |
| Your own network drops | Backoff and retry. Your dot is what your opponent sees |
| You refresh | You rejoin as the same player from `localStorage`, position restored |
| Two tabs, same player | The later one takes the identity, the earlier goes read only |
| Server rejects a move | The piece returns and the board resyncs to the server's position |

The last row is the one to get right. The client applies a move optimistically, because
waiting for a round trip to see your own piece move would undo everything the motion work
achieved. If the server disagrees, the position snaps to the server's, which is
authoritative. The piece identity model already in the reducer makes that snap animate
rather than jump.

---

## 10. Order of work

Each step ends somewhere testable.

**0. Provision Upstash Redis** through the Vercel Marketplace, and wire it with `ioredis`
against the `rediss://` endpoint rather than `@upstash/redis`. Section 2 has the reason.
Prove pub/sub works across two processes before writing anything else: a publisher in one
`node` process and a subscriber in another, both against the real instance. If that does not
work, nothing above it will, and it is ten lines to find out.

**1. `lib/room/` against an in-memory store.** Key generation, protocol types, and the
service: create, join, move, leave, plus the five room cap. Unit tests for an illegal move,
a move out of turn, a move from a player not in the room, two moves racing on one version,
and a sixth room being refused.
*Exit: the service is correct with no network and no provider.*

**2. Swap in the real store.** The service does not change, only the implementation behind
the interface. The cap becomes the atomic script from section 3.
*Exit: the same suite passes against the provisioned store, including the cap under
concurrent creates.*

**3. The WebSocket route and pub/sub fan-out.** `experimental_upgradeWebSocket`, a
subscriber per instance, and the publish on every state change. Rate limits on create and
join.
*Exit: two `wscat` sessions on one room see each other's moves.*

**4. `use-room.ts` and the transport.** Connect, backoff, reconnect, resume from `version`,
optimistic local moves, reconcile on rejection, identity in `localStorage`. This is where
the real difficulty is, not on the server.
*Exit: two browser tabs play a full game, including across a forced reconnect.*

**5. The polling fallback.** Same interface, worse latency, used when the socket will not
establish.
*Exit: the game is playable with WebSocket upgrades blocked.*

**6. The dialog and the presence dot.** Section 8's budget is the constraint.
*Exit: the flow works from a shared link and from a typed key.*

**7. Two-page browser verification.** Section 11.

---

## 11. How it gets verified

The existing suite drives one page. Rooms need two, and the interesting failures are all
about what the second page sees. Puppeteer drives both directly.

- A creates a room, B joins with the key, both report the same position.
- A move on A appears on B without a poll interval's delay, which is the reason for the
  transport choice and so is worth asserting as a latency bound.
- A move out of turn is rejected and neither board changes.
- An illegal move posted straight to the API is rejected, and the room's position afterwards
  is unchanged.
- **A forced reconnect is invisible.** Drop B's socket, let it reconnect, and assert A's
  presence dot never left "here". This is the check that protects the grace window, and the
  one most likely to regress.
- Closing B moves A's dot to away, then to gone, on section 7's timings.
- Reopening B rejoins as the same player with the position intact.
- Backgrounding a tab does not report that player as gone.
- A sixth room is refused with a visible message.
- With WebSocket upgrades blocked, the game still plays over the fallback.

The reconnect and backgrounding checks are the ones a manual test never catches, because
both need the patience to sit and watch nothing happen for the right length of time.

---

## 12. Open questions

1. **Who picks sides?** Simplest is the creator choosing white, black or random when making
   the room. Deciding when the second player joins needs another round trip and another
   state.
2. **How long does a room live?** A day is long for a twenty minute game and short for
   "let's finish this tomorrow". Suggest 24 hours, refreshed on every move. It also decides
   how quickly the five slots free up.
3. **Rematch in the same room, or a new key?** A rematch is friendlier. A new key is simpler
   and makes the state machine smaller.
4. **Is there a clock?** Not proposed. It is a separate feature whose failure modes are all
   about disconnects, and it would make the server the timekeeper.
5. **Spectators?** Not proposed. It turns a room from two slots into an audience, and it
   interacts badly with a cap of five.

---

## 13. Out of scope

Accounts, matchmaking against strangers, ratings, chat, saved history, tournaments. Each one
turns a small game you send to a friend into a service that needs moderation.
