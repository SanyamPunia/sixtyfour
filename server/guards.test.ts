import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { originAllowed, parseOrigins, RateLimiter } from "./guards.ts";

const ALLOWED = ["https://sixtyfour.example", "http://localhost:3000"];

describe("origin allowlist", () => {
  test("an allowed origin passes", () => {
    assert.equal(originAllowed("https://sixtyfour.example", ALLOWED), true);
    assert.equal(originAllowed("http://localhost:3000", ALLOWED), true);
  });

  test("another site is refused", () => {
    assert.equal(originAllowed("https://elsewhere.example", ALLOWED), false);
  });

  test("a lookalike host is refused", () => {
    // Anything short of a full match is a different site, however much it reads like one.
    for (const near of [
      "https://sixtyfour.example.evil.test",
      "https://evil.test/https://sixtyfour.example",
      "https://sixtyfour-example.test",
      "http://sixtyfour.example",
    ]) {
      assert.equal(originAllowed(near, ALLOWED), false, `${near} was allowed`);
    }
  });

  test("case and a trailing slash do not decide it either way", () => {
    assert.equal(originAllowed("HTTPS://SixtyFour.Example/", ALLOWED), true);
  });

  test("a missing origin is refused unless the check is switched off", () => {
    // Every browser sends `Origin` on an upgrade, so a request without one is not a page.
    assert.equal(originAllowed(undefined, ALLOWED), false);
    assert.equal(originAllowed("", ALLOWED), false);
    assert.equal(originAllowed(undefined, ["*"]), true);
  });

  test("an empty allowlist refuses everything", () => {
    assert.equal(originAllowed("https://sixtyfour.example", []), false);
  });

  test("origins parse out of one environment variable", () => {
    assert.deepEqual(parseOrigins("a.test, b.test ,,c.test"), ["a.test", "b.test", "c.test"]);
    assert.deepEqual(parseOrigins(undefined), []);
    assert.deepEqual(parseOrigins(""), []);
  });
});

describe("rate limiter", () => {
  test("allows up to the limit and then stops", () => {
    const limiter = new RateLimiter(3, 1000);
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => limiter.allow(1000 + i)),
      [true, true, true, false],
    );
  });

  test("the window slides rather than resetting on a boundary", () => {
    // A fixed window would let a client spend its whole allowance at the end of one window
    // and again at the start of the next, which is twice the limit back to back.
    const limiter = new RateLimiter(3, 1000);
    for (let i = 0; i < 3; i++) assert.equal(limiter.allow(1900 + i), true);
    assert.equal(limiter.allow(2000), false, "a new second reset the count");
    assert.equal(limiter.allow(2899), false);
    assert.equal(limiter.allow(2901), true, "the oldest hit never aged out");
  });

  test("a refused call does not consume a slot", () => {
    const limiter = new RateLimiter(1, 1000);
    assert.equal(limiter.allow(1000), true);
    for (let i = 0; i < 50; i++) limiter.allow(1100 + i);
    // If the refusals had been recorded, the window would still be full here.
    assert.equal(limiter.allow(2001), true);
  });
});
