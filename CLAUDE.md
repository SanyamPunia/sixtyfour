# CLAUDE.md

@AGENTS.md

@~/.claude/rules/base.md

@~/.claude/rules/frontend.md

@~/.claude/rules/typescript.md

## Project overview

sixtyfour, a minimal chess game. One board, a row of round controls, and a bot at three
difficulties, or a friend over a shared link. The whole product is a single screen. The
design goal is a board that feels alive through quiet motion, and a page that says as little
as it can get away with.

The page used to show no visible text at all except the material number. The move list broke
that, on purpose: a board with no clock and no notation gives a player nothing to work out
what just left the board with, which is the one question the quiet version could not answer.
It is still held to the same standard. One word per row, no headings, and nothing on screen
before the first move.

The control row is not a fixed set. Difficulty and side are dropped in a room, where they
have nothing to set, and the camera exists only once a game has a result. Adding a control
means deciding when it is absent, not only what it does.

This is a public repository.

## Rule 0, provenance hygiene, non-negotiable

**Nothing in this repository may name, link to, or identify any external product, site,
author, or project that informed its design.** This outranks every other rule in this file.

Scope. It applies to all of it, with no exceptions:

- Source code, comments, and doc-strings
- Every markdown file, including this one, `PLAN.md`, `README.md`, and any `AGENTS.md`
- Commit messages, commit bodies, branch names, and tag names
- `package.json` fields, page titles, metadata, Open Graph text, and the favicon
- File names, directory names, CSS class names, test fixture names, and variable names
- The deployment project name, since it appears in the deploy URL
- Issue titles, pull request descriptions, and release notes

What this means in practice:

1. **Never use credit or lineage phrasing that points outward.** Describe what the code
   does, not what it resembles. The denylist enumerates the exact phrasings and lives with
   the design notes, so this file never has to repeat them. That is deliberate: a rule file
   that spells out the banned terms would trip its own guard.
2. **Never copy path data, sprite sheets, or asset files from anywhere.** Every SVG glyph
   in this project is drawn here. A borrowed path is both an attribution problem and a
   licensing one.
3. **Never add a credit, even a kind one.** The answer is a flat no, not a smaller
   mention.
4. **Design notes that need external context do not live here.** They live outside this
   directory entirely. Do not create a file here for them, and do not add a `.gitignore`
   entry for them either, because the ignore file is itself committed and the entry would
   name the thing it hides.
5. **The pre-commit guard must be installed before the first commit.** It greps every
   staged diff against a denylist and refuses the commit on a hit. It lives in
   `.git/hooks/`, which git never pushes. Do not move it to a managed hooks directory
   inside the repo. Installation is a one-line script kept with the design notes.

If you are unsure whether a sentence leaks, delete the sentence. Nothing in this project is
worth a traceable mention.

## Rooms

Play a friend over a shared link or a typed key. `MULTIPLAYER.md` is the design record and
holds the reasoning, including why the transport was changed after it was built.

The shape, in one line: five route handlers under `app/api/rooms/`, Redis holding the rooms,
and every rule in `lib/room/service.ts`, which knows about neither.

Four things are worth knowing before changing any of it.

1. **The server decides.** A move is shown locally the moment it is made and is not real
   until it comes back. Anything refused is undone by replacing the board with the one the
   server sent. Never move a check into the client, and never trust a move as coordinates:
   resolve it against the position's own legal list, which is what `fromUci` does.
2. **Rooms are polled, not pushed.** A route handler is `(Request) => Response`, and that
   signature cannot express taking over a connection, so websockets are not available here
   at all. The cost is that a move can take a poll interval to appear. The interval is
   therefore the latency of the whole feature and the request rate of the whole feature at
   the same time, which is why it changes with what is being waited for and stops entirely
   while the tab is hidden.
3. **Rooms are capped at five, globally, and that cap is also the attack surface.** The cap
   is what stops a link somewhere busy turning into a bill. It is also the only way the
   feature can be taken from everybody at once, because five requests with no account behind
   them can hold every slot. Two things answer that, and both are needed. A room's lease
   measures silence rather than age: any poll or move pushes it back, so a room lives as long
   as somebody is in it and closes thirty minutes after the last of them stops looking. And
   one caller may open five rooms an hour, so the slots cannot be retaken the moment they
   free. The cap check and the write are one atomic step in the store, because a handler that
   counts and then writes lets two simultaneous creates make a sixth, and there is no single
   process to serialise them.
4. **Resignation is the one ending the engine cannot work out.** `lib/chess` can look at any
   arrangement of pieces and say whether it is mate, a stalemate or a draw, and no
   arrangement says that somebody decided they had lost. So it lives on the room record and
   on `GameState` beside `status`, never inside it, and `isOver` is the question to ask
   rather than `isGameOver`. Both players are told what happened: the one who gave up reads
   "you resigned", and the other reads "you win, they resigned", because a board that stops
   and says "you win" with the pieces still even is indistinguishable from a bug.
5. **A version guards every write.** Taking a seat advances it as well as moving does. A
   poll is what tells the other player, so nothing needs to push that update, but the rule
   still holds: a move sent against a version the room has passed is refused rather than
   applied to a board the sender never saw.

## Commands

```bash
pnpm dev
pnpm typecheck
pnpm lint         # biome
pnpm test         # node:test, includes the perft suite and the live-store contract
pnpm build
pnpm check        # the gate: lint, typecheck, test, build
pnpm verify       # drives the built app in a real browser, run after pnpm build
```

## Environment

`.env.local` is git-ignored. There is one variable, and one optional one.

| Variable | Required | What happens without it |
|---|---|---|
| `REDIS_URL` | for rooms | The room routes answer 503 and the interface says rooms are unavailable. Everything else works: the board, the bot and the whole single-player product need no backend at all. |
| `REDIS_PREFIX` | no | Namespaces every key. Set it on preview deployments and it is set by `pnpm verify`, so neither spends a slot from production's five-room cap. They share one Redis. |

Use `rediss://` and the native endpoint, not the REST one. Route handlers run on Node, so a
TCP connection is available, and using it means the connection string is the only credential
this needs.

## Stack declaration

| Parameter | This project |
|---|---|
| Framework | Next.js 16.3, App Router, Turbopack |
| Package manager | `pnpm`. Commit `pnpm-lock.yaml`, never a `package-lock.json`. |
| Linter and formatter | Biome, not ESLint or Prettier |
| Icon library | `lucide-react` |
| Color system | Semantic tokens in `globals.css` only. **No hex, no palette utilities, no arbitrary color values in components.** See the token list in `PLAN.md` section 7. |
| Type scale | `text-xs` and `text-sm` carry the UI. There is almost no text. |
| Casing | **All lowercase**, via `text-transform` on `body`. Write copy in sentence case. |
| Default radius | Squircle for the board via `lib/squircle.ts`. `rounded-full` for controls. |
| Focus pattern | shadcn defaults |
| Fonts | Geist for sans, Geist Mono, Inter for the material badge |
| Class helper | `cn()` |
| Primitives | `radix-ui` for tooltip and the confirm dialog, styled with this project's tokens. Never hand-roll a focus trap or a dismissible overlay. |
| Text that changes | `torph` via `components/ui/text-morph.tsx`, never imported directly at a call site. |
| Runtime dependencies | Next, React, lucide-react, clsx, tailwind-merge, radix-ui, class-variance-authority, `torph`, plus `ioredis`, which only the room routes import. Adding anything else needs a reason in this table. |
| Dev dependencies | Biome, TypeScript, Tailwind, puppeteer-core (drives the browser verification script) |
| Build gate | `pnpm check` |

## Dependency rule

The chess engine, the search, the squircle geometry, and every animation are written in
this repository. Three candidate dependencies were measured and rejected because the hand
written version was faster, smaller, or exact:

- A chess rules library. Ours runs at 8 to 10 million nodes per second and the library
  would have been the search bottleneck.
- An animation library. CSS `linear()` easing carries every spring in the project.
- A squircle library. The generator is 26 lines.

Do not add any of the three back without a measurement that says otherwise.

`radix-ui` is an exception, and deliberately so. A confirm dialog needs a focus trap,
scroll lock, escape handling, and correct `alertdialog` semantics. That is not a styling
problem, and hand-rolling it produces an accessibility bug rather than a saved dependency.

`torph` is the second exception, and it does not reopen the animation-library question. It
animates one thing: a string changing into a different string, segment by segment. CSS
cannot do that at all, because there is no way to address the parts of a text node, so this
is not a case of paying for something already covered. Measured before adding: 6KB gzipped
across both entry points, no dependencies, MIT.

It also takes stiffness and damping, which is the same parameterisation the `linear()`
easings were sampled from, so `text-morph.tsx` passes the settle spring the pieces already
slide on. The dependency adopts the project's motion rather than introducing its own.

Everything else stays as it was. Do not reach for it to fade, slide, or stagger anything.

## Architecture

```
app/                    layout, page, globals.css, robots.ts, sitemap.ts
  api/rooms/            the room API. Four lines each, calling lib/room/handlers.ts
public/                 click.mp3, move.mp3, capture.mp3, the only binary assets
components/
  game/                 the one feature. Components, hooks, and motion constants
    pieces/             one SVG component per piece type
    move-list.tsx       what has been played, beside the board or under it
  ui/                   shadcn primitives, plus text-morph.tsx
  smooth-corners.tsx    measures the board, then writes the squircle clip path
  site-credit.tsx       the byline, pinned bottom right
lib/
  sound.ts              every clip and its volume, in one place. No React
  preferences.ts        difficulty, side and mute, stored and read back. No React
  chess/                pure engine. No React
  game/                 reducer, piece identity and the move log. Pure, so node --test
                        can reach it
  bot/                  pure search plus the worker entry. No React
  room/                 every rule a room has, plus the wire types both sides import
  site.ts               the origin, name and description. One place, see below
  share/                the picture a finished game produces. No React
  pieces.ts             the six glyphs as path data, used by the board and the picture
  squircle.ts           continuous-corner path generator
  utils.ts              cn()
scripts/
  verify.mjs            drives the built app in Chrome and asserts against the real DOM
```

`lib/` holds no React. Hooks live with their feature in `components/game/`.

**`lib/room/` is the rules, and it knows about nothing.** No HTTP, no Redis, no React.
`service.ts` takes a `RoomStore` and returns decisions, which is why the races that matter
are tested in milliseconds against `memory-store.ts` and then re-tested unchanged against
the real one. `protocol.ts` is imported by both the browser and the routes, so it is the
contract between two things that deploy separately: every response carries `protocol`, and a
mismatch is reported rather than guessed at.

**`handlers.ts` is the API, and `app/api/` is an adapter.** A route file reads the body,
calls one handler, and returns the result. Everything that could be wrong lives in
`handlers.ts`, so the whole API is covered by `node --test` with no server booted. If a rule
ever needs adding it goes in `service.ts`, not in either of them.

**The move log is derived, never recorded.** `lib/game/move-log.ts` turns `state.history`
into the rows the list draws, and a `Move` already carries everything it needs: the piece as
it stood, the piece standing on the destination, the promotion and the flags. So there is no
second list to keep in step. That is what makes it correct in a room, where `fromMoves`
rebuilds the history from the server's word on every correction. A log held beside `history`
would be another thing to rebuild, and the one that fell behind would be the one a player was
reading. En passant is the only case that needs the flag rather than the `captured` field: the
pawn it takes was never standing on the destination square.

Two things the rows do not spell out. A castle is named "castles" and a promotion "promotes",
because "king g1" describes a castle without naming it and "pawn e8" hides the only
interesting thing that happened. And whose move it was is carried by the glyph's fill, which
is keyed to the chess colour, plus a `sr-only` sentence per row that says "you" or "opponent".
The painted row stays three fragments wide.

**The list is beside the board on `lg` and under it below that.** The wide one is
`absolute left-full`, not a flex sibling, so the board keeps the centre of the page and never
moves: a panel in the flow would slide a centred board left by half its width the first time a
move was played. The narrow one is a sideways scroller that holds its 2rem whether or not
there is anything in it, for the same reason in the other axis. Both are the same component.

**It is capped to the board's height and scrolls. No scrollbar.** A scrollbar is the one
piece of chrome here that no stylesheet fully owns: its width, its resting visibility and
whether it takes layout space are the platform's to decide, so one rule reads as an overlay
on one machine and a permanent grey rail on another. `scrollbar-width: none`, and a
`mask-image` fades whichever edge still has list behind it instead. The component writes
`data-fade-start` and `data-fade-end` from the scroll offset and the stylesheet does the rest.
The fade is position-aware rather than constant because the list sits at its newest row, and a
fade that is always on would permanently dim the move most worth reading.

Three things in this file are load-bearing in ways that are not obvious, and each was a bug
first.

- **The list renders even when it is empty.** Returning null before the first move left the
  ref null through the first render, and the effect that attaches the scroll listener and the
  `ResizeObserver` has no dependency that changes when a row finally arrives. So it returned
  early and never ran again: the fades stayed off for the whole game.
- **`h-full` on the column is what makes it scroll.** `overflow-y: auto` on an auto-height
  block has no height to scroll within, so it grew instead. It ran out of its own wrapper,
  past the board and off the bottom of the page, and the scrollbar that then appeared on every
  move was the document's.
- **A row's `relative`.** `sr-only` is absolutely positioned, and without a containing block
  on the row it resolves against the nearest positioned ancestor outside the scroller, escapes
  the overflow clip, and lands at its static offset inside the scrolled content. Sideways on a
  phone that is off the right of the viewport, and the page gets a horizontal scrollbar while
  the list itself looks perfectly correct.

All three share a shape worth remembering: the list looked right in every case, and only the
page around it was wrong. `scripts/verify.mjs` measures the cap, the fades at both ends and
document overflow because none of them can be seen by looking at the rows.

**The piece paths live in `lib/pieces.ts`, not in the component that draws them.** The
shared image redraws the board from the same data, and a second copy would drift. The drift
would only show up in something a player had already posted somewhere.

**`lib/share/` builds the picture rather than screenshotting the page.** A screenshot
carries hover states, the cursor, and whatever size the viewport happened to be. `card.ts`
emits an SVG at a fixed size and `render.ts` rasterises it, then draws the caption onto the
canvas afterwards: an SVG rasterised through an `Image` gets no access to the page's fonts,
so text inside it comes out in a system serif. Colours are read from the live tokens at draw
time, so the picture follows the theme.

**Nothing outside `lib/room/redis-store.ts` builds a store.** `sharedRoomStore()` is a
module-level singleton, because route handlers are called rather than started and there is
nowhere to construct one and hand it around. A client per request would open a connection
per request.

## Casing

**Everything renders lowercase, and that is done in `globals.css`, not in the copy.**

The board surface was always lowercase: the result is the only sentence the game has, and
"you win" sits better under a board than "You win" does. The dialogs arrived later in
sentence case, and the two met inside the share dialog, where a card reading "you win" sat
under a title reading "Share this game".

**Write new copy in sentence case and let the stylesheet lower it.** The markup keeps real
casing, so screen readers, copied text, the page title and anything a crawler reads all
still get "Share this game". Writing the strings lowercase would throw that away for the
same appearance.

Two things need saying out loud:

- **Form controls do not inherit it.** Tailwind's preflight sets `font: inherit` on them,
  which does not carry `text-transform`, so `button`, `input`, `select` and `textarea` are
  given it explicitly. Without that a label inside a button keeps its source casing while
  everything around it lowercases.
- **A room key is data, not style.** It is read out loud and typed back from an alphabet
  that is uppercase by definition, so `[data-room-key]` is set to uppercase and the join
  input keeps its own `uppercase`. It is the one string here whose case carries meaning.

## The origin lives in one place

`lib/site.ts` holds the URL, and the metadata, the canonical link, `robots.txt` and the
sitemap all read it. Three copies would be three chances to move host and forget one, and a
sitemap advertising an address the canonical link disagrees with is worse than no sitemap,
because a crawler then has to choose between them.

**Deploy a change to it only once DNS resolves.** `og:image` is an absolute URL built from
this, so shipping ahead of the record points every social crawler at a host that does not
answer, and they cache that. A card that failed to fetch stays broken until the cache
expires or is manually purged, which is far more annoying than waiting.

## Motion rule, and one documented exception

Board choreography uses the duration and easing tokens defined in `globals.css` and listed
in `PLAN.md` section 6.1. Those run from 90ms to 420ms.

**This overrides the global frontend rule that allows only `duration-150` and
`duration-200`.** The exception is scoped to board and piece motion. Controls keep 150ms
and 200ms for hover and press, exactly as the global rule requires.

Every timing and easing value is a token in `globals.css`, and the springs those were
sampled from are recorded with the design notes. No magic numbers in JSX.

## Piece identity

Each piece is assigned a stable id at setup and keeps it for the whole game. Position comes
from a `transform` on an absolutely positioned overlay, never from being a child of a
square. The entire animation model depends on both facts. Do not key a piece by its square.
