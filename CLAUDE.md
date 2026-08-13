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

## Planned work

`MULTIPLAYER.md` is the plan for rooms: play a friend over a shared link or a typed key,
with a truthful indication of whether they are actually there. None of it is built.

It is the first feature that needs a backend and the first that costs money to run, so read
its sections 1 and 2 before starting: the transport choice and the reason for it are the
decisions everything else hangs off.

## Commands

```bash
pnpm dev
pnpm typecheck
pnpm lint         # biome
pnpm test         # node:test, includes the perft suite
pnpm build
pnpm check        # the gate: lint, typecheck, test, build
pnpm verify       # drives the built app in a real browser, run after pnpm build
```

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
| Runtime dependencies | Next, React, lucide-react, clsx, tailwind-merge, radix-ui, class-variance-authority. Adding anything else needs a reason in this table. |
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
  squircle.ts           continuous-corner path generator
  utils.ts              cn()
scripts/
  verify.mjs            drives the built app in Chrome and asserts against the real DOM
```

`lib/` holds no React. Hooks live with their feature in `components/game/`.

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
