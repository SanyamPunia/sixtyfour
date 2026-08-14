# Rooms, plan

Play a friend. One player creates a room, shares a link or a six character key, the other
joins, and both see whether the other is actually there.

This is the design record for the feature. `PLAN.md` covers the single-player product.

**Built, then rebuilt on a different transport.** Section 2 argued for WebSockets and was
followed. It was then reversed, deliberately, and section 2 is left standing because the
reasoning in it is still correct about what WebSockets buy. What changed is what they cost.

## The transport reversal

WebSockets need a process that outlives a request. Next.js route handlers are
`(Request) => Response`, and that signature cannot express taking over a connection: a
WebSocket handshake ends in `101 Switching Protocols`, after which the same TCP connection
stops speaking HTTP for good. Node surfaces that as an `upgrade` event carrying the raw
socket. There is no `Response` that means "and now give me the socket", so the framework
cannot expose it even if it wanted to. A serverless function also ends when it returns,
which is the opposite lifecycle to one that holds state per connection.

So websockets meant a second process to deploy and pay for. That was built and it worked:
plain `http` and `ws`, Redis pub/sub for cross-instance fan-out, tested with two servers
against one store. It was then removed in favour of polling on route handlers, because one
deployable is worth more here than instant moves. The rules did not change: `lib/room/`
never knew what the transport was.

What was given up, stated plainly. A move can take up to a poll interval to appear, against
a board tuned to a 190ms slide. Presence is only as fresh as the last poll. Both are real
and neither is hidden.

What was gained. Nothing to deploy but the site, no second thing to keep alive, no origin
allowlist, no `wss://` URL baked into a build, and one environment variable instead of four.
The polling rate follows what is being waited for and stops while the tab is hidden, so an
idle game is close to free.

## What the build changed

**Staleness is judged before anything else about a move.** The plan implied checking the
turn first. A player who missed two moves is on their own turn holding a legal-looking move,
so a turn check would refuse it with a reason that is both false and unactionable. The one
true answer is that they are behind, and only the version knows that.

**Taking a seat advances the room version.** This was not in the plan, and on the socket
transport it was the one bug in the feature that reported healthy while the game never
started: the first player's opening move was judged against a board that moved on when their
opponent sat down, and was correctly refused as stale. Polling makes it self-correcting,
since the next poll carries the new version, but the rule is the same and worth knowing.

**Presence is one number, not a state machine.** The plan described three states and a grace
window. All three fall out of how stale one timestamp is, so nothing needs a flag for
"disconnected". A poll is what keeps a seat warm, and a page that stops polling goes stale
by itself.

**Seats do not swap on a rematch.** Swapping is the politer convention, but it changes a
player's colour underneath them with no move to explain it, and the honest version needs a
message of its own. Section 16 listed this as open.

**The rules ended up knowing nothing.** `lib/room/service.ts` takes a store and returns
decisions. That split is why the transport could be replaced without touching a rule, and
why every race is tested in milliseconds against an in-memory store and then re-tested
unchanged against the live one.

---

## 1. What this changes

Today the product has no backend. The page is statically prerendered, the engine and the
bot run in the browser, and nothing is stored anywhere. Rooms break all three.

Three things follow, and they are the real cost of the feature:

- **It starts costing money to run.** Section 3 caps that at a number rather than leaving it
  open ended.
- **It can fail in ways nothing here currently can.** A network drops, a room expires, two
  tabs disagree, a laptop sleeps mid game. Every one of those needs a visible state.
- **It adds UI to a product whose whole point is not having any.** Section 9 is the budget.

---

## 2. Transport: WebSockets, on portable code

**Nothing here uses a Vercel API.** The realtime side is a plain Node process: `http`,
`ws`, and `ioredis`. It runs on Vercel today and on Fly, Railway, Render or a VPS tomorrow
with no code change, because there is nothing in it that knows where it is.

That rules out `experimental_upgradeWebSocket()` from `@vercel/functions`, which exists
only because Next.js does not expose upgrade handling. Using it would put the one piece of
this feature that is hard to move behind a vendor's experimental API. A standard
`WebSocketServer` over `http.createServer()` is the same amount of code and goes anywhere.

Moves arrive the instant they are played. Nothing about this product tolerates a move
appearing a second and a half after it was made: the whole board is tuned at the scale of
a 190ms slide and a 140ms lift, and a delay an order of magnitude larger than that would be
the slowest thing on screen by a wide margin. Presence is also better served, because a tab
closing produces a `close` event immediately rather than a heartbeat quietly going stale.

One fact about distributed WebSocket servers shapes the design, and it is true everywhere,
not just on Vercel.

### A shared store is required regardless

A connection is held by whichever process accepted it, and **a second connection is not
guaranteed to reach that same process**. Two players in a room routinely land on different
instances, which cannot see each other's memory. This is true of any WebSocket server
running more than one instance, so it is not something a deployment choice avoids.

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

Use the native protocol instead: `ioredis` against the `rediss://` endpoint. This is a Node
process with full TCP, so the reason the HTTP SDK exists does not apply.

Upstash is itself portable: it is Redis. Anything speaking the Redis protocol can replace it
without the room code noticing, which is the point of not reaching for a proprietary API to
talk to it.

```
PUBLISH   works over either. It is fire and forget
SUBSCRIBE needs the TCP endpoint. This decides the client
```

Two consequences worth planning for:

- **One subscriber connection per server process, not per player.** It is shared by every
  room that process is serving. Subscribe on a room key when the first local socket for it
  opens, and unsubscribe when the last one closes, or a long lived process slowly
  accumulates dead subscriptions.
- **`ioredis` is a new runtime dependency**, and the first in this project that is not UI.
  `CLAUDE.md` lists the runtime dependencies and says adding one needs a reason in that
  table. This is the reason, and that table gets updated when this ships.

### Reconnection, and one constraint that is not ours

Sockets drop. Networks change, laptops sleep, proxies time out. The client reconnects with
backoff and resumes from its `version`, and that is required wherever this runs.

**On Vercel specifically there is a second cause**: a function closes its connections when
it reaches its maximum duration, 300 seconds by default, so a healthy game reconnects every
few minutes. That is a property of running on serverless functions, not of the design. On a
long lived Node process there is no such clock and connections last as long as the network
holds them.

Keeping the server portable therefore removes the constraint rather than working around it.
The reconnect logic stays either way, because networks drop regardless, but the forced
five minute cycle is something the deployment target decides.

Whatever the cause, a reconnect must not show up as "your opponent left". Section 7 handles
that with a grace window. Getting it wrong is what makes multiplayer feel broken.

### Polling is the fallback, not the design

Some networks block WebSocket upgrades. If the socket cannot establish after a few
attempts, the client falls back to polling the same room endpoint every 1.5 seconds. It is
worse, and it is much better than a blank screen. The transport sits behind one interface
so the fallback is a swap rather than a second implementation of the game.

### What is portable, and what is not

| | |
|---|---|
| `lib/room/` | Plain TypeScript. Runs anywhere, tested with `node --test` |
| `server/` | `http`, `ws`, `ioredis`. Runs with `node index.js` on anything |
| The store | Redis. Upstash today, any Redis tomorrow, no code change |
| The game | Already a static page. Unchanged by this |
| Deployment | The only thing tied to a platform, and it is a `Dockerfile` or a start command |

The single dependency on where this runs is the URL in `NEXT_PUBLIC_ROOM_SERVER`.

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

## 4. Where the moves come from

This is the largest risk in the feature, and it is in the existing code rather than the new
code.

The reducer today assumes one shape: the human plays one colour, the bot plays the other,
and `use-bot.ts` fires whenever `position.side !== humanColor`. Room mode has to slot into
that without turning `reducer.ts` into two products sharing a file.

**The reducer does not learn about rooms.** It already has the only action that matters:

```ts
{ type: "play"; move: Move }
```

`use-bot.ts` dispatches that today. `use-room.ts` dispatches exactly the same thing when a
move arrives from the other player. The reducer cannot tell them apart and does not need to.

**One flag decides which one is running.** `GameState` gains `opponent: "bot" | "room"`, and:

- `use-bot.ts` returns early unless `opponent === "bot"`. One line, at the top of the effect.
- The difficulty and side controls hide when `opponent === "room"`, per section 9.
- `isHumanTurn` gains one more condition, the same way it already handles `thinking` and
  `pendingPromotion`.

**What the local move path does change** is that a human move must now be sent as well as
applied. That belongs in the hook, not the reducer, which stays pure.

The mistake to avoid is a second reducer, or a `mode` check sprinkled through the existing
one. Every branch added to `reducer.ts` is a branch the 63 existing tests do not cover.

---

## 5. Authority

**The server validates every move.** Not the clients.

This is nearly free, and it is the best property the existing architecture hands us:
`lib/chess` is pure TypeScript with no React and no browser API. The engine that has passed
perft to depth 5 runs unchanged inside a function. There is no second implementation to keep
in step, which is the usual reason server authoritative multiplayer is expensive.

A move arrives as coordinates. The server loads the room, checks the sender owns the side to
move, generates the legal moves for that position, and rejects anything not in the list. A
client cannot put an illegal position on the board even if it tries.

**The server also decides when the game is over.** It has `gameStatus` from the same engine,
so it computes checkmate, stalemate and every draw after applying a move, and sends the
result with the position. Two clients cannot disagree about whether a game ended, and a
client that reconnects after the final move is told immediately.

**Joining is atomic, like the room cap.** Read, check the seat is free, write is three steps,
and two people opening the same link at the same moment will both pass the check. Claim the
seat with a compare and set on `version` and let the loser get "room is full". Without it the
common case, sending a link to two people at once, silently seats one player twice.

### Every message

`protocol.ts` is the whole surface between the two halves, so it is short on purpose.

| Direction | Message | Carries |
|---|---|---|
| client to server | `join` | player id, and the key from the URL |
| client to server | `move` | from, to, promotion, and the `version` it was played against |
| client to server | `rematch` | offer or accept |
| client to server | `ping` | nothing. Presence only |
| server to client | `state` | fen, version, history, status, both seats |
| server to client | `moved` | the move, the new fen, the new version, the status |
| server to client | `presence` | which seat, and here, away or gone |
| server to client | `error` | a code the dialog can render, never a raw message |

Every server message carries `version`. A client that is behind asks for `state` rather than
trying to catch up move by move, which is why the room keeps the fen and not just a move
list.

---

## 6. Shape

Two deployables, because they have nothing in common. The game is a static page. The room
server is a long lived process holding sockets. Keeping them apart is also what keeps the
game deployable anywhere it is today.

```
lib/room/           shared by both sides. No React, no Node, no browser API
  key.ts            generate and validate a room key
  protocol.ts       every message either side can send
  store.ts          the store interface: state, atomic swap, pub/sub, the room cap
  service.ts        create, join, move, leave. Pure logic over the store
  service.test.ts

server/             a plain Node service. No framework, no platform API
  index.ts          http.createServer plus a ws WebSocketServer
  routes.ts         POST /rooms, GET /rooms/:key, and the socket at /rooms/:key/ws
  redis.ts          ioredis, and the per-instance subscriber

components/game/
  use-room.ts       the client half: connect, reconnect, send, reconcile
  room-transport.ts the socket, its backoff, and the polling fallback behind one interface
  room-button.tsx   opens the dialog
  room-dialog.tsx   create or join
  presence-dot.tsx  is the other player there
```

The room server owns everything about rooms, including create and join. Splitting those
into Next route handlers would mean two services talking to the same Redis for the same
data, and would put half the feature back inside the framework.

The client reaches it through one environment variable, `NEXT_PUBLIC_ROOM_SERVER`. The game
keeps working with that unset: the room control simply does not appear, and the bot is the
whole product, exactly as it is today.

`lib/room/` holds no React and no Node API, so `node --test` reaches the service directly
with no network and no provider, and the client can import the same types.

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

## 7. The key

Six characters from a 31 character alphabet: digits and letters minus `0`, `O`, `1`, `I` and
`L`, which are the pairs people confuse reading a key aloud or typing it from a screenshot.

About 887 million keys, and at most five live at any moment, so guessing one is not a
practical attack. Short enough to say over the phone, which is the point.

Two ways in, landing in the same place:

- A link, `sixtyfour-liart.vercel.app/?room=K7M2QX`
- Typing the key, for when the link arrives as a screenshot or over the phone

---

## 8. Presence, which is the actual feature

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
inside 20 seconds never appears to have left, which covers a routine reconnect and a phone
locked for a moment alike. Report those as gone and the indicator becomes
noise that people learn to ignore, which is worse than not having it.

Shown as a second dot beside the turn dot, in the language the board already speaks: solid
when here, hollow when away, faded when gone, with a tooltip naming it. No banner, no toast,
no new vocabulary.

**Publish changes, do not poll `lastSeen`.** The process holding a player's socket already
knows they are alive. It only needs Redis when the other player is somewhere else, so a
heartbeat costs nothing until presence actually changes, and a change is pushed rather than
discovered on someone's next read. On the estimate in section 3 that is most of the per game
command count removed, and it makes the indicator faster at the same time.

---

## 9. UI budget

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

## 10. What can go wrong, and what it looks like

Each needs a state, and none can be silent.

| | What the player sees |
|---|---|
| All five rooms are in use | The dialog says so and stays open, with the reason |
| Room key does not exist | The dialog says so. It is almost always a typo |
| Room is full | Same. Two people already hold the sides |
| Room expired | Same, with the reason, since the link may be days old |
| Opponent has not joined | "waiting for someone to join", key still visible |
| The socket drops and returns | Nothing. A routine reconnect is invisible by design |
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

## 11. The cross-origin boundary

The game and the room server are two deployables, so they are two origins. Everything in
this section follows from that, and none of it is optional.

**The WebSocket must check `Origin` itself.** Browsers do not apply the same-origin policy
to WebSocket connections and send no preflight. A server that accepts any upgrade will
happily be driven by a page on someone else's domain. Check the header against an allowlist
in the upgrade handler and refuse anything not on it. This is the one security control the
feature genuinely needs, and it is four lines.

**The HTTP endpoints need CORS**, because create and join are cross-origin `POST`s from the
browser. Same allowlist, returned as `Access-Control-Allow-Origin`, plus an `OPTIONS`
handler for the preflight.

The allowlist is an environment variable, not a constant, because it differs per
environment: `localhost:3000` in development, the production domain in production, and every
Vercel preview URL if previews are meant to work. Previews are the part people forget, and
the symptom is a feature that works everywhere except in review.

**`wss://` in production, not `ws://`.** A page served over HTTPS cannot open an insecure
socket, so a room server without TLS is unreachable from the deployed game even though it
works locally.

---

## 12. Deploying the server

The game deploys as it does today and is unaffected.

The room server is a long lived process, which is a different thing from what this repo has
deployed before. It needs:

- A start command, `node server/index.js`, and a build step to get there
- `REDIS_URL` and `ALLOWED_ORIGINS` in its environment
- A health endpoint, `GET /health`, so the platform can tell a wedged process from a busy one
- One instance is enough. The five-room cap means it will never need a second, and a single
  process makes the pub/sub fan-out mostly a local concern

**One wrinkle worth knowing before it costs an hour.** `lib/` imports are relative and carry
explicit `.ts` extensions, because `node --test` resolves neither the `@/` alias nor a bare
specifier. The server imports `lib/room/` and `lib/chess/`, so whatever builds it has to
accept that convention. Node's own type stripping does, which is the path of least
resistance and keeps the server dependency-free beyond `ws` and `ioredis`.

---

## 13. Running it, and keeping the gate honest

### Two processes locally

`pnpm dev` becomes two things. The game on 3000, the room server on 3001, and a
`pnpm dev:all` that runs both.

**Develop against a local Redis, not the Upstash instance.** `docker run -p 6379:6379 redis`
speaks the same protocol, so `ioredis` cannot tell the difference, and it means no network
round trip on every keystroke and no shared state between two people working at once. The
provisioned instance is for deployed environments.

### Secrets

`REDIS_URL` is a credential and lives only on the server. It must never appear in anything
the browser downloads, which in Next means it must never be prefixed `NEXT_PUBLIC_`.

The only public variable this feature adds is `NEXT_PUBLIC_ROOM_SERVER`, which is a URL and
not a secret. `.env*` is already gitignored, and the pre-commit guard's denylist should gain
a pattern for `rediss://` so a connection string cannot be committed by accident. That is
the same reasoning as rule 0: a rule nobody can forget beats a rule everybody must remember.

### The gate

`pnpm check` is lint, typecheck, test, build. Adding `server/` means:

- Biome and TypeScript must cover it. It is not inside the Next app, so it needs to be in
  `tsconfig` includes and the Biome file list, or it silently goes unchecked.
- `lib/room/*.test.ts` runs under the existing `node --test` glob, which is why the service
  lives in `lib/`.
- The server needs its own build step, or a runtime that reads TypeScript directly.

### The verification harness

`scripts/verify.mjs` starts one server today. Rooms need a second, plus a local Redis, and
the harness has already been bitten once by a server outliving its run: `npx` spawns a child
that holds the port, and killing the parent leaves it. Both servers must start detached and
be killed by process group, the way the existing one now is.

The port guard needs the same treatment. Refusing to run when something already answers on
the room server's port is what stops a stale process from making a green run meaningless.

---

## 14. Order of work

Each step ends somewhere testable.

**0. Provision Upstash Redis** and wire it with `ioredis` against the `rediss://` endpoint,
not `@upstash/redis`. Section 2 has the reason. Prove pub/sub works across two processes
before writing anything else: a publisher in one `node` process and a subscriber in another,
both against the real instance. If that does not work, nothing above it will, and it is ten
lines to find out.

**1. `lib/room/` against an in-memory store.** Key generation, protocol types, and the
service: create, join, move, leave, plus the five room cap. Unit tests for an illegal move,
a move out of turn, a move from a player not in the room, two moves racing on one version,
and a sixth room being refused.
*Exit: the service is correct with no network and no provider.*

**2. Swap in the real store.** The service does not change, only the implementation behind
the interface. The cap becomes the atomic script from section 3.
*Exit: the same suite passes against the provisioned store, including the cap under
concurrent creates.*

**3. `server/`: the Node service, the pub/sub fan-out, and the origin check.** `http.createServer` with a `ws`
`WebSocketServer`, a subscriber per process, and a publish on every state change. Rate
limits on create and join. No framework and no platform API, so it runs with `node` locally.
*Exit: two `wscat` sessions on one room see each other's moves, against a server started
with `node`, not a deploy.*

**4. `use-room.ts` and the transport, plus the one reducer change.** Connect, backoff,
reconnect, resume from `version`, optimistic local moves, reconcile on rejection, identity in
`localStorage`. The reducer gains `opponent` and `use-bot.ts` gains its early return, per
section 4, and nothing else in the existing state machine moves. This is where the real
difficulty is, not on the server.
*Exit: two browser tabs play a full game, including across a forced reconnect.*

**5. The polling fallback.** Same interface, worse latency, used when the socket will not
establish.
*Exit: the game is playable with WebSocket upgrades blocked.*

**6. The dialog and the presence dot.** Section 9's budget is the constraint.
*Exit: the flow works from a shared link and from a typed key.*

**7. Two-page browser verification.** Section 15, plus the harness work in section 13: a
second server started detached, its own port guard, and a local Redis.

---

## 15. How it gets verified

Three layers, because the failures live in different places.

### The service, with `node --test`

`lib/room/service.test.ts` against the in-memory store. Illegal move, move out of turn, move
from a player who is not in the room, two moves racing on one version, two joins racing for
one seat, a sixth room refused. No network, no provider, no browser.

### The server, with two socket clients

Between the pure logic and the browser sits a layer neither of them covers: connection
handling. A `node --test` file that opens real `ws` clients against a server on a random port
catches what the other two cannot.

- A connection from a disallowed `Origin` is refused.
- Two clients on one room see each other's `moved` messages.
- **Closing the last socket for a room unsubscribes from that key.** This is the one that
  leaks silently: nothing breaks, the process just accumulates subscriptions until it falls
  over days later, and no user-facing test will ever see it.
- Reconnecting with a stale `version` gets a full `state`, not a replay.

### The browser, with two pages

The interesting failures here are all about what the second page sees. Puppeteer drives both
directly.

- A creates a room, B joins with the key, both report the same position.
- A move on A appears on B without a poll interval's delay, which is the reason for the
  transport choice and so is worth asserting as a latency bound.
- A move out of turn is rejected and neither board changes.
- An illegal move posted straight to the API is rejected, and the room's position afterwards
  is unchanged.
- **A forced reconnect is invisible.** Drop B's socket, let it reconnect, and assert A's
  presence dot never left "here". This is the check that protects the grace window, and the
  one most likely to regress.
- Closing B moves A's dot to away, then to gone, on section 8's timings.
- Reopening B rejoins as the same player with the position intact.
- Backgrounding a tab does not report that player as gone.
- A sixth room is refused with a visible message.
- Two clients joining the same empty room at the same instant produce one player and one
  "room is full", never two players in the same seat.
- With `NEXT_PUBLIC_ROOM_SERVER` unset the room control does not render and the bot game is
  untouched, which is the state every existing check already runs in.
- With WebSocket upgrades blocked, the game still plays over the fallback.

The reconnect and backgrounding checks are the ones a manual test never catches, because
both need the patience to sit and watch nothing happen for the right length of time.

---

## 16. Open questions, as they were

Every one of these was answered during the build. Kept as written because the reasoning for
each still explains why the answer went the way it did, and the answers are recorded at the
top of this file and in `CLAUDE.md`.

Decided: the creator picks a side, a room lives 24 hours refreshed on every move, a rematch
reuses the same room and keeps both seats, and there are no clocks, no spectators and
nothing special for abandonment beyond a seat becoming reclaimable.

### The questions

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
6. **What happens when someone never comes back?** Presence says "gone" and the board sits
   there until the room expires. A win by abandonment needs a timer and a rule about how
   long is long enough, and getting that wrong hands someone a loss for a train tunnel.
   Doing nothing is the safe default and may well be the right one.

---

## 17. Out of scope

Accounts, matchmaking against strangers, ratings, chat, saved history, tournaments. Each one
turns a small game you send to a friend into a service that needs moderation.
