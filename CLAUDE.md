# CLAUDE.md

@AGENTS.md

@~/.claude/rules/base.md

@~/.claude/rules/frontend.md

@~/.claude/rules/typescript.md

## Project overview

sixtyfour, a minimal chess game. One board, three round controls, and a bot at three
difficulties. The whole product is a single screen. The design goal is a board that feels
alive through quiet motion, and a page that shows no visible text except one number.

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
still holds the reasoning, in particular sections 1 and 2 on why this is a WebSocket server
on portable code rather than anything host-specific.

The shape, in one line: a Node process holds the sockets, Redis holds the rooms and fans
messages between processes, and every rule lives in `lib/room/service.ts`, which knows about
neither.

Three things are worth knowing before changing any of it.

1. **The server decides.** A move is shown locally the moment it is made and is not real
   until it comes back. Anything refused is undone by replacing the board with the one the
   server sent. Never move a check into the client, and never trust a move as coordinates:
   resolve it against the position's own legal list, which is what `fromUci` does.
2. **Rooms are capped at five, globally.** This is a hobby project on one small instance and
   the cap is what stops a link somewhere busy turning into a bill. The check and the write
   are one atomic step in the store, because a service that counts and then writes lets two
   simultaneous creates make a sixth.
3. **A version guards every write.** Taking a seat advances it as well as moving does, so a
   player who is already seated has to be told when someone sits down. Forgetting that is a
   bug where everything reports healthy and the first move is refused as stale. There is a
   regression test named for it.

## Commands

```bash
pnpm dev
pnpm room         # the room server, port 3001. Needs REDIS_URL for anything real
pnpm typecheck
pnpm lint         # biome
pnpm test         # node:test, includes the perft suite and the live-store contract
pnpm build
pnpm check        # the gate: lint, typecheck, test, build
pnpm verify       # drives the built app in a real browser, run after pnpm build
```

## Environment

`.env.local` is git-ignored and holds all of it. Nothing here has a default worth shipping.

| Variable | Used by | What happens without it |
|---|---|---|
| `REDIS_URL` | room server, tests | The server keeps rooms in memory, which is fine for one process on a laptop and wrong for anything else. The live-store tests skip. |
| `ALLOWED_ORIGINS` | room server | Defaults to `http://localhost:3000`. Every other origin is refused, which is the whole point, so a deployment that does not set this serves nobody. |
| `NEXT_PUBLIC_ROOM_SERVER` | the site | Rooms report as unavailable in the interface. Baked in at build time, so changing it needs a rebuild. |
| `PORT` | room server | 3001. |

Use `rediss://` and not `redis://`, and the native endpoint rather than a REST one.
`MULTIPLAYER.md` section 2 has the reason: a REST API cannot hold a subscription.

## Stack declaration

| Parameter | This project |
|---|---|
| Framework | Next.js 16.3, App Router, Turbopack |
| Package manager | `pnpm`. Commit `pnpm-lock.yaml`, never a `package-lock.json`. |
| Linter and formatter | Biome, not ESLint or Prettier |
| Icon library | `lucide-react` |
| Color system | Semantic tokens in `globals.css` only. **No hex, no palette utilities, no arbitrary color values in components.** See the token list in `PLAN.md` section 7. |
| Type scale | `text-xs` and `text-sm` carry the UI. There is almost no text. |
| Default radius | Squircle for the board via `lib/squircle.ts`. `rounded-full` for controls. |
| Focus pattern | shadcn defaults |
| Fonts | Geist for sans, Geist Mono, Inter for the material badge |
| Class helper | `cn()` |
| Primitives | `radix-ui` for tooltip and the confirm dialog, styled with this project's tokens. Never hand-roll a focus trap or a dismissible overlay. |
| Runtime dependencies | Next, React, lucide-react, clsx, tailwind-merge, radix-ui, class-variance-authority. Plus two the room server needs and the site never imports: `ws` for the sockets and `ioredis` for the store. Adding anything else needs a reason in this table. |
| Dev dependencies | Biome, TypeScript, Tailwind, puppeteer-core (drives the browser verification script), `@types/ws` |
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

`radix-ui` is the exception, and deliberately so. A confirm dialog needs a focus trap,
scroll lock, escape handling, and correct `alertdialog` semantics. That is not a styling
problem, and hand-rolling it produces an accessibility bug rather than a saved dependency.

## Architecture

```
app/                    layout, page, globals.css
public/                 click.mp3, move.mp3, capture.mp3, the only binary assets
components/
  game/                 the one feature. Components, hooks, and motion constants
    pieces/             one SVG component per piece type
  ui/                   shadcn primitives
  smooth-corners.tsx    measures the board, then writes the squircle clip path
  site-credit.tsx       the byline, pinned bottom right
lib/
  sound.ts              every clip and its volume, in one place. No React
  preferences.ts        difficulty, side and mute, stored and read back. No React
  chess/                pure engine. No React
  game/                 reducer and piece identity. Pure, so node --test can reach it
  bot/                  pure search plus the worker entry. No React
  room/                 every rule a room has, plus the wire types both sides import
  squircle.ts           continuous-corner path generator
  utils.ts              cn()
server/                 the room server process. Never imported by the site
scripts/
  verify.mjs            drives the built app in Chrome and asserts against the real DOM
```

`lib/` holds no React. Hooks live with their feature in `components/game/`.

**`lib/room/` is the rules, and it knows about nothing.** No sockets, no Redis, no React.
`service.ts` takes a `RoomStore` and returns decisions, which is why the races that matter
are tested in milliseconds against `memory-store.ts` and then re-tested unchanged against
the real one. `protocol.ts` is imported by both the browser and the server, so it is the
contract between two things that deploy separately: every message carries `protocol`, and a
mismatch is refused rather than guessed at.

**`server/` is a shell over that, and should stay one.** `hub.ts` decodes a message, calls
one function in the service, and publishes the answer. `guards.ts` holds the origin
allowlist and the rate limiter, both pure, because a security check that needs a live socket
to exercise tends not to get exercised. `http-api.ts` is the polling fallback and calls the
same service functions, so the two transports cannot come to disagree about what is legal.
`start.ts` builds a server, `index.ts` decides to. If a rule ever needs adding, it goes in
`lib/room/`, not here.

**`node --test` runs `server/` too.** `guards.test.ts` is pure. `hub.test.ts` drives real
sockets on a real port. `cross-instance.test.ts` runs two servers against one Redis, which
is the only test that can catch a move reaching one process and not the other, and it skips
without `REDIS_URL`.

**Imports inside `lib/` are relative, with an explicit `.ts` extension.** `node --test`
runs those files directly and resolves neither the `@/` alias nor an extensionless
specifier. Components reaching into `lib` use `@/lib/...`, which only the bundler sees.

**`scripts/verify.mjs` is where browser-level truth lives.** Unit tests cannot see a clip
path that depends on a measured size, a worker that has to bundle, or whether a tint is
actually perceptible. Add a check there when a change is only observable in a browser.

Any new directory gets documented here before the task is considered done.

## Motion rule, and one documented exception

Board choreography uses the duration and easing tokens defined in `globals.css` and listed
in `PLAN.md` section 6.1. Those run from 90ms to 420ms.

**This overrides the global frontend rule that allows only `duration-150` and
`duration-200`.** The exception is scoped to board and piece motion. Controls keep 150ms
and 200ms for hover and press, exactly as the global rule requires.

Every timing value is a named constant in `components/game/motion.ts`. No magic numbers in
JSX.

## Piece identity

Each piece is assigned a stable id at setup and keeps it for the whole game. Position comes
from a `transform` on an absolutely positioned overlay, never from being a child of a
square. The entire animation model depends on both facts. Do not key a piece by its square.
