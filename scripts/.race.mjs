import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 3193,
  base = `http://localhost:${port}`;
const servers = [];
process.on("exit", () => {
  for (const c of servers) {
    try {
      process.kill(-c.pid, "SIGKILL");
    } catch {}
  }
});
servers.push(
  spawn("npx", ["next", "start", "-p", String(port)], {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, REDIS_PREFIX: "race:" },
  }),
);
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--no-sandbox"],
});
const open = async (url) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 560, height: 780 });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    window.__net = [];
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(typeof input === "string" ? input : input.url);
      const method = init?.method ?? "GET";
      const t = Date.now();
      if (method === "POST" && url.includes("/move")) {
        await new Promise((r) => setTimeout(r, 900));
      }
      const res = await original(input, init);
      const clone = res.clone();
      clone
        .json()
        .then((b) =>
          window.__net.push({
            at: Date.now() - t,
            method,
            url: url.split("/api/rooms")[1],
            v: b?.room?.version,
            n: b?.room?.moves?.length,
          }),
        )
        .catch(() => {});
      return res;
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".board-surface");
  return page;
};

const host = await open(base);
await host.evaluate(() =>
  document.querySelector('button[aria-label="Play with a friend"]')?.click(),
);
await host.waitForSelector("form", { timeout: 8000 });
await host.evaluate(() =>
  [...document.querySelectorAll("button")]
    .find((b) => b.textContent?.trim() === "Create a room")
    ?.click(),
);
const node = await host.waitForSelector("[data-room-key]", { timeout: 20000 });
const { key, seat } = await node.evaluate((n) => ({
  key: n.dataset.roomKey,
  seat: n.dataset.roomSeat,
}));
await host.keyboard.press("Escape");
const guest = await open(`${base}/?room=${key}`);
await new Promise((r) => setTimeout(r, 3000));

const play = async (page) =>
  await page.evaluate(async () => {
    const settle = () => new Promise((r) => setTimeout(r, 60));
    const own = [...document.querySelectorAll(".sq")].filter((n) =>
      (n.getAttribute("aria-label") ?? "").includes("your "),
    );
    for (const sq of own) {
      sq.click();
      await settle();
      const target = document.querySelector(".hint-dot")?.closest(".sq");
      if (target) {
        const to = target.dataset.sq;
        target.click();
        await settle();
        return { from: sq.dataset.sq, to };
      }
      sq.click();
      await settle();
    }
    return null;
  });

// White moves first so it is genuinely black's turn, then black moves and is watched.
const white = seat === "white" ? host : guest;
const black = seat === "white" ? guest : host;
for (let i = 0; i < 12; i++) {
  if (await play(white)) break;
  await new Promise((r) => setTimeout(r, 700));
}
await new Promise((r) => setTimeout(r, 3000));

console.log("black is about to move");
const moved = await play(black);
console.log("black played", JSON.stringify(moved));
const frames = await black.evaluate(async (square) => {
  const seen = [];
  for (let i = 0; i < 50; i++) {
    const l = document.querySelector(`[data-sq="${square}"]`)?.getAttribute("aria-label") ?? "";
    seen.push(l.includes("empty") ? "." : "X");
    await new Promise((r) => setTimeout(r, 50));
  }
  return seen.join("");
}, moved?.to);
console.log("destination square over 2.5s:", frames);
console.log(
  "network seen by black:",
  JSON.stringify(await black.evaluate(() => window.__net.slice(-8))),
);
await browser.close();
const { default: Redis } = await import("ioredis");
const r = new Redis(process.env.REDIS_URL);
const k = await r.keys("race:*");
if (k.length) await r.del(...k);
await r.quit();
