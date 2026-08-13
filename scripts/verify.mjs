/**
 * Drives the built app in a real browser and reports what it finds.
 *
 * Screenshots at load are not enough: the interesting state only exists after hydration,
 * after a ResizeObserver has fired, and after a click. This waits for each of those
 * explicitly instead of guessing at a delay.
 *
 * Uses the system Chrome through puppeteer-core, so nothing is downloaded.
 *
 *   node scripts/verify.mjs [--port 3140] [--shots]
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 3140;
const wantShots = args.includes("--shots");
const base = `http://localhost:${port}`;
const OUT = "/tmp/sixtyfour-shots";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

async function waitForServer(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// A server left over from an earlier run would answer here with a stale build, while our
// own `next start` fails to bind and says nothing. That produced a confusing hunt for a
// chunk that no longer existed, so refuse to start rather than test the wrong thing.
try {
  await fetch(base, { signal: AbortSignal.timeout(700) });
  console.error(`something is already listening on ${port}. Stop it, or pass --port.`);
  process.exit(1);
} catch {
  // Nothing there, which is what we want.
}

/*
 * Detached, so each server gets its own process group.
 *
 * `npx next start` spawns a child that actually holds the port. Killing the npx process
 * alone leaves that child running, and the next run then tests against a stale build
 * served by a process nobody is tracking. Killing the whole group is what makes cleanup
 * real. This already caused one long hunt for a chunk that no longer existed.
 */
const servers = [];
const startServer = (command) => {
  const child = spawn("npx", command, { stdio: "ignore", detached: true });
  servers.push(child);
  return child;
};
const stopServers = () => {
  for (const child of servers.splice(0)) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
};
process.on("exit", stopServers);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopServers();
    process.exit(1);
  });
}

const server = startServer(["next", "start", "-p", String(port)]);

if (!(await waitForServer(base))) {
  console.error("server never came up");
  stopServers();
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--no-sandbox", "--disable-gpu"],
});

if (wantShots) mkdirSync(OUT, { recursive: true });

for (const scheme of ["light", "dark"]) {
  console.log(`\n[${scheme}]`);
  const page = await browser.newPage();
  await page.setViewport({ width: 560, height: 720, deviceScaleFactor: 2 });
  // The theme is an explicit choice now, not a system reading, so set the stored value
  // before the page loads rather than emulating a media feature.
  await page.evaluateOnNewDocument((value) => {
    localStorage.setItem("sixtyfour-theme", value);
  }, scheme);
  // Count play() calls rather than trying to hear anything. Patched before any app code
  // runs, so the very first move is counted too.
  await page.evaluateOnNewDocument(() => {
    window.__plays = [];
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function patched() {
      window.__plays.push(this.currentSrc || this.src);
      return original.apply(this, arguments);
    };
  });

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400) pageErrors.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    const reason = r.failure()?.errorText ?? "unknown";
    // A media element that is still fetching when the page navigates reports an aborted
    // request. This script reloads several times, so it sees one every run. Narrowed to
    // that exact combination: a 404 or a 500 on the same file still fails the run, and
    // the sound is separately asserted to serve and to play.
    if (reason === "net::ERR_ABORTED" && /\/(move|capture|click)\.mp3$/.test(r.url())) return;
    pageErrors.push(`failed ${r.url()} (${reason})`);
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });

  // The clip path only exists once the ResizeObserver has measured the board.
  try {
    await page.waitForFunction(() => document.querySelector('[data-state="ready"]') !== null, {
      timeout: 5000,
    });
  } catch (error) {
    console.log("  hydration never completed. page errors:");
    for (const e of pageErrors) console.log(`    ${e}`);
    if (pageErrors.length === 0) console.log("    (none reported)");
    throw error;
  }

  const info = await page.evaluate(() => {
    const sc = document.querySelector("[data-state]");
    const cs = getComputedStyle(sc);
    const root = getComputedStyle(document.documentElement);
    const sq = document.querySelector(".sq").getBoundingClientRect();
    // The svg box is 86% of the square by construction, so measuring it proves nothing.
    // getBBox gives the glyph's real extent in viewBox units, which is what a player sees.
    const svgEl = document.querySelector(".piece-body svg");
    const svg = svgEl.getBoundingClientRect();
    // getBBox on the svg covers every child, so it survives the glyph being split
    // across a body path and a mark path.
    const ink = svgEl.getBBox();
    const board = document.querySelector('[aria-label="Chess board"]').getBoundingClientRect();
    return {
      state: sc.dataset.state,
      clip: cs.clipPath.slice(0, 30),
      board: Math.round(board.width),
      squareFill: (((ink.height / 32) * svg.height) / sq.width) * 100,
      boardLight: root.getPropertyValue("--board-light").trim(),
      pieceOpponent: root.getPropertyValue("--piece-opponent").trim(),
      surface: root.getPropertyValue("--surface").trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      pieces: document.querySelectorAll(".piece").length,
      squares: document.querySelectorAll(".sq").length,
      docScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rootTheme: document.documentElement.dataset.theme,
    };
  });

  check(
    "squircle clip applied",
    info.state === "ready" && info.clip.startsWith("path("),
    info.clip,
  );
  check(
    "64 squares, 32 pieces",
    info.squares === 64 && info.pieces === 32,
    `${info.squares}/${info.pieces}`,
  );
  check("board is square and sized", info.board > 300, `${info.board}px`);
  check(
    // Re-baselined for the simplified set, whose marks sit lower in the box than the
    // earlier ornate ones. The band guards against a regression, it is not a law.
    "glyph ink is 60-80% of its square",
    info.squareFill > 60 && info.squareFill < 80,
    `${info.squareFill.toFixed(0)}%`,
  );
  check("no horizontal page scroll", info.docScrollX === 0, `${info.docScrollX}px`);
  check(
    `${scheme} tokens active`,
    scheme === "dark" ? info.boardLight === "#232327" : info.boardLight === "#fdfdfd",
    info.boardLight,
  );
  check(`${scheme} set before paint`, info.rootTheme === scheme, info.rootTheme);

  // A full interaction: pick up a pawn, confirm hints, play the move, confirm it landed.
  const labelOf = (sq) => `[aria-label^="${sq},"]`;
  await page.click(labelOf("e2"));
  await page.waitForFunction(() => document.querySelectorAll(".hint-dot").length > 0, {
    timeout: 3000,
  });
  const afterSelect = await page.evaluate(() => ({
    dots: document.querySelectorAll(".hint-dot").length,
    lifted: document.querySelectorAll('.piece[data-lifted="true"]').length,
    selected: document.querySelector('[aria-label^="e2,"]').innerHTML.includes("sq-select"),
  }));
  check("selecting e2 shows two hint dots", afterSelect.dots === 2, `${afterSelect.dots}`);
  check("selected piece is lifted", afterSelect.lifted === 1);
  check("selected square is tinted", afterSelect.selected);

  await page.click(labelOf("e4"));
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label^="e4,"]').getAttribute("aria-label").includes("pawn"),
    { timeout: 3000 },
  );
  const afterMove = await page.evaluate(() => ({
    e4: document.querySelector('[aria-label^="e4,"]').getAttribute("aria-label"),
    e2: document.querySelector('[aria-label^="e2,"]').getAttribute("aria-label"),
    lastMove: document.querySelectorAll('[style*="sq-lastmove"]').length,
    status: document.querySelector("[aria-live]").textContent,
  }));
  const sound = await page.evaluate(async () => {
    const response = await fetch("/move.mp3", { method: "HEAD" });
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      plays: window.__plays.length,
      source: window.__plays.at(-1) ?? "",
    };
  });
  check("the move sound is served", sound.status === 200, `${sound.status} ${sound.type}`);
  for (const clip of ["capture", "click"]) {
    const served = await page.evaluate(async (name) => {
      const r = await fetch(`/${name}.mp3`, { method: "HEAD" });
      return { status: r.status, type: r.headers.get("content-type") };
    }, clip);
    check(
      `the ${clip} sound is served`,
      served.status === 200,
      `${served.status} ${served.type}`,
    );
  }
  check("a move plays it", sound.plays >= 1, `${sound.plays} play call(s)`);
  check("it plays the move clip", sound.source.endsWith("/move.mp3"), sound.source);

  check("pawn is on e4", afterMove.e4.includes("your pawn"), afterMove.e4);
  check("e2 is empty", afterMove.e2.includes("empty"), afterMove.e2);
  check("last move tints two squares", afterMove.lastMove === 2, `${afterMove.lastMove}`);
  check("status region updated", afterMove.status.length > 0, `"${afterMove.status}"`);

  // The turn dot: alive on your move, still and dimmed while the bot searches.
  const thinkingDot = await page.evaluate(() => {
    const dot = document.querySelector(".turn-dot");
    return {
      active: dot.dataset.active ?? "off",
      opacity: Number(getComputedStyle(dot).opacity),
    };
  });
  check(
    "the turn dot goes quiet while the bot thinks",
    thinkingDot.active === "off",
    thinkingDot.active,
  );

  // The bot answers through the worker, and is held back by the think floor so its reply
  // reads as a move rather than as the board glitching.
  const botStart = Date.now();
  await page.waitForFunction(
    () => document.querySelector("[aria-live]").textContent.trim() === "your move",
    { timeout: 8000 },
  );
  const botMs = Date.now() - botStart;
  const afterBot = await page.evaluate(() => {
    const occupied = [...document.querySelectorAll("[aria-label]")]
      .map((n) => n.getAttribute("aria-label"))
      .filter((l) => l.includes("opponent"));
    return {
      opponentPieces: occupied.length,
      tints: document.querySelectorAll('[style*="sq-lastmove"]').length,
    };
  });
  // A tint that is present in the DOM but perceptually identical to a plain square is not
  // feedback. Measure the rendered difference rather than trusting the token value.
  const tintDelta = await page.evaluate(() => {
    const parse = (c) => c.match(/\d+/g).map(Number);
    const distance = (a, b) =>
      Math.hypot(
        ...parse(a)
          .slice(0, 3)
          .map((v, i) => v - parse(b)[i]),
      );
    const tinted = document.querySelector('[style*="sq-lastmove"]');
    const square = tinted.closest(".sq");
    const plain = [...document.querySelectorAll(".sq")].find(
      (n) =>
        n.querySelector('[style*="sq-lastmove"]') === null &&
        n.style.background === square.style.background,
    );
    return distance(
      getComputedStyle(tinted).backgroundColor,
      getComputedStyle(plain).backgroundColor,
    );
  });
  check(
    "last move tint is perceptible",
    tintDelta > 12,
    `rgb distance ${tintDelta.toFixed(1)}`,
  );

  const yourDot = await page.evaluate(() => {
    const dot = document.querySelector(".turn-dot");
    return {
      active: dot.dataset.active ?? "off",
      animation: getComputedStyle(dot).animationName,
    };
  });
  check(
    "the turn dot marks your move",
    yourDot.active === "true" && yourDot.animation === "turn-breathe",
    `${yourDot.active} / ${yourDot.animation}`,
  );

  check(
    "bot replied",
    afterBot.opponentPieces === 16,
    `${afterBot.opponentPieces} opponent pieces`,
  );
  check("bot respected the think floor", botMs >= 1100, `${botMs}ms`);
  check("bot replied promptly", botMs < 3000, `${botMs}ms`);
  check("last move tint moved to the bot's move", afterBot.tints === 2, `${afterBot.tints}`);

  // Keyboard runs against a fresh board: by now e2 has already moved, and the default
  // tab stop would land on an empty square.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-state="ready"]') !== null, {
    timeout: 5000,
  });

  // One tab stop on the board, arrows move it, Enter selects.
  const keyboard = await page.evaluate(() => ({
    tabStops: [...document.querySelectorAll(".sq")].filter((n) => n.tabIndex === 0).length,
  }));
  check("board holds exactly one tab stop", keyboard.tabStops === 1, `${keyboard.tabStops}`);

  await page.focus('.sq[tabindex="0"]');
  const startLabel = await page.evaluate(() =>
    document.activeElement.getAttribute("aria-label"),
  );
  await page.keyboard.press("ArrowUp");
  const movedLabel = await page.evaluate(() =>
    document.activeElement.getAttribute("aria-label"),
  );
  check(
    "arrow key moves focus one rank",
    startLabel !== movedLabel,
    `${startLabel} -> ${movedLabel}`,
  );

  const beforeKeyMove = await page.evaluate(() => document.querySelectorAll(".piece").length);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page
    .waitForFunction(() => document.querySelectorAll(".hint-dot").length > 0, { timeout: 3000 })
    .catch(() => {});
  const keyHints = await page.evaluate(() => document.querySelectorAll(".hint-dot").length);
  check("Enter selects a piece from the keyboard", keyHints > 0, `${keyHints} hints`);
  check("piece count unchanged by selecting", beforeKeyMove === 32, `${beforeKeyMove}`);

  // Controls. A new game with moves played must confirm first, and must not act on a
  // cancel. The thinking indicator has to appear while the bot searches.
  await page.click('[aria-label^="d2,"]');
  await page.click('[aria-label^="d4,"]');
  const thinkingSeen = await page
    .waitForFunction(() => document.querySelector(".bar-equalise") !== null, { timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  check("difficulty bars animate while the bot thinks", thinkingSeen);
  await page.waitForFunction(
    () => document.querySelector("[aria-live]").textContent.trim() === "your move",
    { timeout: 8000 },
  );

  await page.click('[aria-label="New game"]');
  const dialogOpen = await page
    .waitForFunction(() => document.querySelector('[role="alertdialog"]') !== null, {
      timeout: 2000,
    })
    .then(() => true)
    .catch(() => false);
  check("new game confirms once moves are played", dialogOpen);

  // A destructive button is the one place contrast cannot be left to eyeballing.
  const danger = await page.evaluate(() => {
    const button = [...document.querySelectorAll('[role="alertdialog"] button')].at(-1);
    const cs = getComputedStyle(button);
    const luminance = (colour) => {
      const [r, g, b] = colour
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
      const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const a = luminance(cs.color);
    const b = luminance(cs.backgroundColor);
    return {
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      textIsLighter: a > b,
    };
  });
  check(
    "the destructive button reads white on red",
    danger.textIsLighter,
    danger.textIsLighter ? "" : "text is darker than its background",
  );
  check(
    "the destructive button meets 4.5:1",
    danger.ratio >= 4.5,
    `${danger.ratio.toFixed(2)}:1`,
  );

  // The dialog and its scrim animate in. Radix keeps the node mounted for the closing
  // animation, so both directions are pure CSS keyed on data-state.
  const dialogMotion = await page.evaluate(() => {
    const content = document.querySelector(".dialog-content");
    const overlay = document.querySelector(".dialog-overlay");
    return {
      contentAnim: getComputedStyle(content).animationName,
      overlayAnim: getComputedStyle(overlay).animationName,
      // The scrim has to deepen in dark, and that only works if `dark:` reads data-theme.
      scrim: getComputedStyle(overlay).backgroundColor,
    };
  });
  check(
    "dialog animates in",
    dialogMotion.contentAnim === "dialog-in" && dialogMotion.overlayAnim === "overlay-in",
    `${dialogMotion.contentAnim} / ${dialogMotion.overlayAnim}`,
  );
  check(
    "the dark: variant follows data-theme",
    scheme === "dark" ? dialogMotion.scrim.includes("0.6") : dialogMotion.scrim.includes("0.4"),
    dialogMotion.scrim,
  );

  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 300));
  const afterCancel = await page.evaluate(() => ({
    dialog: document.querySelector('[role="alertdialog"]') !== null,
    d2: document.querySelector('[aria-label^="d2,"]').getAttribute("aria-label"),
  }));
  check("escape closes the dialog", afterCancel.dialog === false);
  check("cancelling leaves the game alone", afterCancel.d2.includes("empty"), afterCancel.d2);

  await page.click('[aria-label="New game"]');
  await page.waitForFunction(() => document.querySelector('[role="alertdialog"]') !== null, {
    timeout: 2000,
  });
  await page.click('[role="alertdialog"] button:last-of-type');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label^="d2,"]').getAttribute("aria-label").includes("pawn"),
    { timeout: 3000 },
  );
  const afterReset = await page.evaluate(() => ({
    pieces: document.querySelectorAll(".piece").length,
    tints: document.querySelectorAll('[style*="sq-lastmove"]').length,
  }));
  check("confirming resets the board", afterReset.pieces === 32, `${afterReset.pieces} pieces`);
  check("reset clears the last move tint", afterReset.tints === 0, `${afterReset.tints}`);

  // Controls click. Board squares do not: they have the move and capture sounds instead.
  await page.evaluate(() => {
    window.__plays.length = 0;
  });
  await page.click('[aria-label="Toggle light and dark theme"]');
  await page.click('[aria-label="Toggle light and dark theme"]');
  const controlSounds = await page.evaluate(() =>
    window.__plays.map((s) => s.split("/").pop()),
  );
  check(
    "a control click plays the click sound",
    controlSounds.length === 2 && controlSounds.every((s) => s === "click.mp3"),
    `[${controlSounds.join(", ")}]`,
  );

  await page.evaluate(() => {
    window.__plays.length = 0;
  });
  await page.click('[aria-label^="a2,"]');
  const squareSounds = await page.evaluate(() => window.__plays.length);
  check("selecting a square is silent", squareSounds === 0, `${squareSounds} play call(s)`);
  await page.click('[aria-label^="a2,"]');

  const difficultyLabel = await page.evaluate(() =>
    document.querySelector('[aria-label^="Bot difficulty"]').getAttribute("aria-label"),
  );
  await page.click('[aria-label^="Bot difficulty"]');
  const nextLabel = await page.evaluate(() =>
    document.querySelector('[aria-label^="Bot difficulty"]').getAttribute("aria-label"),
  );
  check(
    "difficulty cycles",
    difficultyLabel !== nextLabel,
    `${difficultyLabel} -> ${nextLabel}`,
  );

  // An illegal tap shakes the held piece. It must shake, and it must not blank afterwards:
  // putting the shake on the outer element replaced its permanent `piece-in` animation,
  // and removing the class restarted the entrance, so the piece faded out and back in.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-state="ready"]') !== null, {
    timeout: 5000,
  });
  // The entrance animation is still running right after a reload, and it legitimately
  // takes pieces to opacity 0. Wait for it to settle or it gets blamed for the regression
  // this check is actually looking for.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".piece")].every(
        (n) => getComputedStyle(n).opacity === "1",
      ),
    { timeout: 3000 },
  );
  await page.click('[aria-label^="e2,"]');
  await page.waitForFunction(() => document.querySelectorAll(".hint-dot").length > 0, {
    timeout: 3000,
  });
  const shake = await page.evaluate(async () => {
    const piece = document.querySelector('.piece[data-lifted="true"]');
    let sawShake = false;
    let minOpacity = 1;
    const started = performance.now();
    document.querySelector('[aria-label^="e7,"]').click();
    await new Promise((resolve) => {
      const tick = () => {
        if (piece.querySelector(".shake") !== null) sawShake = true;
        minOpacity = Math.min(minOpacity, Number(getComputedStyle(piece).opacity));
        if (performance.now() - started < 700) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return { sawShake, minOpacity };
  });
  check("an illegal tap shakes the held piece", shake.sawShake);
  check(
    "the piece never blanks after shaking",
    shake.minOpacity === 1,
    `min opacity ${shake.minOpacity}`,
  );

  // Drag and drop. A real pointer gesture, not a synthesised click: press on d2, move in
  // steps so the threshold is crossed, release over d4.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-state="ready"]') !== null, {
    timeout: 5000,
  });
  const centreOf = (selector) =>
    page.$eval(selector, (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  const from = await centreOf('[aria-label^="d2,"]');
  const to = await centreOf('[aria-label^="d4,"]');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / 6,
      from.y + ((to.y - from.y) * i) / 6,
    );
  }
  const midDrag = await page.evaluate(() => {
    const held = document.querySelector('.piece[data-dragging="true"]');
    return {
      dragging: held !== null,
      translated: held !== null && held.style.translate !== "",
      hints: document.querySelectorAll(".hint-dot").length,
    };
  });
  check("dragging lifts the piece off its square", midDrag.dragging);
  check("the piece follows the pointer", midDrag.translated);
  check("hints appear during the drag", midDrag.hints > 0, `${midDrag.hints}`);

  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label^="d4,"]').getAttribute("aria-label").includes("pawn"),
    { timeout: 3000 },
  );
  const afterDrop = await page.evaluate(async () => {
    // Poll rather than sample once: the cleanup runs in a rAF, so a single read races it.
    // If it is still set after 500ms the attribute is genuinely leaked.
    const started = performance.now();
    let clearedAt = null;
    while (performance.now() - started < 500) {
      if (document.querySelectorAll('.piece[data-dragging="true"]').length === 0) {
        clearedAt = Math.round(performance.now() - started);
        break;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return {
      d4: document.querySelector('[aria-label^="d4,"]').getAttribute("aria-label"),
      d2: document.querySelector('[aria-label^="d2,"]').getAttribute("aria-label"),
      clearedAt,
    };
  });
  check(
    "dropping on a legal square plays the move",
    afterDrop.d4.includes("your pawn"),
    afterDrop.d4,
  );
  check("the origin square is empty", afterDrop.d2.includes("empty"), afterDrop.d2);
  check(
    "no piece is left in a dragging state",
    afterDrop.clearedAt !== null,
    afterDrop.clearedAt === null
      ? "still set after 500ms"
      : `cleared after ${afterDrop.clearedAt}ms`,
  );

  // An illegal drop returns the piece rather than moving it.
  await page.waitForFunction(
    () => document.querySelector("[aria-live]").textContent.trim() === "your move",
    { timeout: 8000 },
  );
  // The bot's replies are randomised, so nothing can be assumed about what sits on b5.
  // The invariant is that an illegal drop changes nothing, so record both squares first
  // and compare against themselves rather than against a fixed expectation.
  const beforeIllegal = await page.evaluate(() => ({
    b1: document.querySelector('[aria-label^="b1,"]').getAttribute("aria-label"),
    b5: document.querySelector('[aria-label^="b5,"]').getAttribute("aria-label"),
    pieces: document.querySelectorAll(".piece").length,
  }));
  const fromB = await centreOf('[aria-label^="b1,"]');
  const toB = await centreOf('[aria-label^="b5,"]');
  await page.mouse.move(fromB.x, fromB.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(
      fromB.x + ((toB.x - fromB.x) * i) / 6,
      fromB.y + ((toB.y - fromB.y) * i) / 6,
    );
  }
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const afterIllegal = await page.evaluate(() => ({
    b1: document.querySelector('[aria-label^="b1,"]').getAttribute("aria-label"),
    b5: document.querySelector('[aria-label^="b5,"]').getAttribute("aria-label"),
    pieces: document.querySelectorAll(".piece").length,
    leftover: document.querySelectorAll('.piece[data-returning="true"]').length,
  }));
  check(
    "an illegal drop leaves the piece home",
    afterIllegal.b1 === beforeIllegal.b1 && afterIllegal.b1.includes("knight"),
    afterIllegal.b1,
  );
  check(
    "an illegal drop does not change the target",
    afterIllegal.b5 === beforeIllegal.b5,
    `${beforeIllegal.b5} -> ${afterIllegal.b5}`,
  );
  check(
    "an illegal drop captures nothing",
    afterIllegal.pieces === beforeIllegal.pieces,
    `${beforeIllegal.pieces} -> ${afterIllegal.pieces}`,
  );
  check(
    "the return animation cleans up",
    afterIllegal.leftover === 0,
    `${afterIllegal.leftover}`,
  );

  /*
   * Captures sound different, from either side.
   *
   * Played out rather than asserted from the code path: pick a capture when one is on
   * offer, otherwise any legal move, and watch which clip fires each time a piece leaves
   * the board. The bot's captures matter as much as the player's, so the loop runs until
   * it has seen one of each.
   */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-state="ready"]') !== null, {
    timeout: 5000,
  });

  const countPieces = () =>
    page.evaluate(() => ({
      // A taken piece stays mounted for one move so its exit animation can run, so the
      // live count has to exclude it or a capture never registers.
      own: document.querySelectorAll('.piece:not([data-captured]) svg[style*="piece-own"]')
        .length,
      opponent: document.querySelectorAll(
        '.piece:not([data-captured]) svg[style*="piece-opponent"]',
      ).length,
    }));

  let humanCapture = null;
  let botCapture = null;

  for (let turn = 0; turn < 60 && (humanCapture === null || botCapture === null); turn++) {
    const before = await countPieces();
    await page.evaluate(() => {
      window.__plays.length = 0;
    });

    /*
     * Steer toward whichever capture is still missing.
     *
     * While waiting on a bot capture, play only quiet moves: that leaves material hanging
     * and the bot takes free material immediately. Once that is seen, switch to preferring
     * captures to get the player's. Always taking when possible made bot captures rare
     * enough that the check failed about one run in three.
     *
     * A frame is awaited after every click. React batches state updates, so the hints for
     * a square that was just clicked do not exist yet on the following line.
     */
    const preference = botCapture === null ? "quiet" : "capture";
    const played = await page.evaluate(async (want) => {
      const frame = () => new Promise((r) => requestAnimationFrame(r));

      // The loop pushes pawns, so it reaches the last rank. The picker's scrim covers the
      // board until it is answered, and every later click would land on it.
      const picker = document.querySelector(".promo-choice");
      if (picker !== null) {
        picker.click();
        await frame();
        return "quiet";
      }
      // A finished game is inert, and no further move is coming.
      if (document.querySelector('.board-surface[data-over="true"]') !== null) return "over";
      const ownSquares = () =>
        [...document.querySelectorAll(".sq")].filter((n) =>
          n.getAttribute("aria-label").includes("your "),
        );
      const order =
        want === "capture" ? [".hint-ring", ".hint-dot"] : [".hint-dot", ".hint-ring"];

      for (const selector of order) {
        for (const square of ownSquares()) {
          square.click();
          await frame();
          const target = document.querySelector(selector);
          if (target !== null) {
            target.closest(".sq").click();
            await frame();
            return selector === ".hint-ring" ? "capture" : "quiet";
          }
          // Drop the selection before trying the next square, or the next click lands as
          // a move for the piece still being held.
          square.click();
          await frame();
        }
      }
      return "none";
    }, preference);
    if (played === "none" || played === "over") break;

    const afterHuman = await countPieces();
    if (afterHuman.opponent < before.opponent) {
      humanCapture = await page.evaluate(() => window.__plays.at(-1) ?? "");
    }

    const finished = await page
      .waitForFunction(
        () => document.querySelector("[aria-live]").textContent.trim() === "your move",
        { timeout: 10000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!finished) break;

    const afterBot = await countPieces();
    if (afterBot.own < afterHuman.own) {
      botCapture = await page.evaluate(() => window.__plays.at(-1) ?? "");
    }
  }

  check(
    "a capture by the player plays the capture clip",
    humanCapture !== null && humanCapture.endsWith("/capture.mp3"),
    humanCapture ?? "no player capture occurred",
  );
  check(
    "a capture by the bot plays the same clip",
    botCapture !== null && botCapture.endsWith("/capture.mp3"),
    botCapture ?? "no bot capture occurred",
  );

  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

  if (wantShots) {
    await page.screenshot({ path: `${OUT}/board-${scheme}.png` });
    await page.click(labelOf("d7"));
    await page.screenshot({ path: `${OUT}/select-${scheme}.png` });
  }
  await page.close();
}

// Narrow viewport, where the height cap has to keep the board on screen.
console.log("\n[390x740 phone]");
const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 740, deviceScaleFactor: 2 });
await phone.goto(base, { waitUntil: "domcontentloaded" });
await phone.waitForFunction(() => document.querySelector('[data-state="ready"]') !== null, {
  timeout: 5000,
});
const small = await phone.evaluate(() => {
  const board = document.querySelector('[aria-label="Chess board"]').getBoundingClientRect();
  return {
    width: Math.round(board.width),
    bottom: Math.round(board.bottom),
    viewport: window.innerHeight,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
check("board fits the width", small.width <= 390 - 32, `${small.width}px`);
check(
  "board fits the height",
  small.bottom <= small.viewport,
  `${small.bottom} of ${small.viewport}`,
);
check("no horizontal scroll", small.overflowX === 0);
if (wantShots) await phone.screenshot({ path: `${OUT}/board-phone.png` });
await phone.close();

/*
 * Hydration, against a development server.
 *
 * React only reports hydration mismatches in development, so every check above is
 * structurally blind to them: they all run against a production build. A theme written by
 * an inline script before hydration is exactly the shape of bug that hides here, and it
 * did hide here once.
 */
console.log("\n[hydration, dev server]");
const devPort = port + 1;
const devBase = `http://localhost:${devPort}`;
startServer(["next", "dev", "-p", String(devPort)]);

if (!(await waitForServer(devBase))) {
  check("dev server came up", false);
} else {
  for (const stored of ["dark", "light", null]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    if (stored !== null) {
      await page.evaluateOnNewDocument(
        (v) => localStorage.setItem("sixtyfour-theme", v),
        stored,
      );
    }
    await page.goto(devBase, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector('[data-state="ready"]') !== null, {
      timeout: 15000,
    });
    await new Promise((r) => setTimeout(r, 900));
    const applied = await page.evaluate(() => document.documentElement.dataset.theme);
    const hydration = errors.filter((e) => /hydrat/i.test(e));
    check(
      `stored theme "${stored}" hydrates cleanly`,
      hydration.length === 0 && applied === (stored ?? "light"),
      `applied ${applied}, ${hydration.length} hydration error(s)`,
    );
    await page.close();
  }
}
await browser.close();
stopServers();

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
