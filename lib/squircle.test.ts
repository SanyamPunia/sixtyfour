import assert from "node:assert/strict";
import test from "node:test";
import { squirclePath } from "./squircle.ts";

/**
 * The golden path for a 508 by 508 box at radius 20 and smoothing 0.6. Regenerating it
 * would make the test tautological, so it is pinned here and any change to the geometry
 * has to be justified against it.
 */
const GOLDEN_508 =
  "M 32 0 L 476 0 c 11.2011 0 16.8016 0 21.0798 2.1799 a 20 20 0 0 1 8.7403 8.7403 " +
  "c 2.1799 4.2782 2.1799 9.8788 2.1799 21.0798 L 508 32 L 508 476 " +
  "c 0 11.2011 0 16.8016 -2.1799 21.0798 a 20 20 0 0 1 -8.7403 8.7403 " +
  "c -4.2782 2.1799 -9.8788 2.1799 -21.0798 2.1799 L 476 508 L 32 508 " +
  "c -11.2011 0 -16.8016 0 -21.0798 -2.1799 a 20 20 0 0 1 -8.7403 -8.7403 " +
  "c -2.1799 -4.2782 -2.1799 -9.8788 -2.1799 -21.0798 L 0 476 L 0 32 " +
  "c 0 -11.2011 0 -16.8016 2.1799 -21.0798 a 20 20 0 0 1 8.7403 -8.7403 " +
  "c 4.2782 -2.1799 9.8788 -2.1799 21.0798 -2.1799 Z";

const numbers = (path: string): number[] => (path.match(/-?\d+\.?\d*/g) ?? []).map(Number);

test("matches the golden path exactly", () => {
  const mine = numbers(squirclePath({ width: 508, height: 508, radius: 20 }));
  const golden = numbers(GOLDEN_508);
  assert.equal(mine.length, golden.length, "same number of coordinates");
  for (const [i, value] of mine.entries()) {
    assert.ok(
      Math.abs(value - (golden[i] as number)) < 1e-4,
      `coordinate ${i}: ${value} vs ${golden[i]}`,
    );
  }
});

test("smoothing 0 degenerates to a plain rounded rectangle", () => {
  const path = squirclePath({ width: 100, height: 100, radius: 20, smoothing: 0 });
  // With no smoothing the cubics collapse to zero length and only the arcs shape the corner.
  assert.match(path, /c 0 0 0 0 0 0 a 20 20 0 0 1 20 20/);
});

test("the radius is capped so corners cannot overlap", () => {
  // A radius far larger than the box must not produce a self-crossing path.
  const path = squirclePath({ width: 40, height: 40, radius: 999 });
  const coords = numbers(path);
  for (const value of coords) {
    assert.ok(Math.abs(value) <= 40.001, `coordinate ${value} stays inside the box`);
  }
});

test("handles a non-square box", () => {
  const path = squirclePath({ width: 200, height: 100, radius: 16 });
  assert.match(path, /^M /);
  assert.match(path, /Z$/);
  assert.equal(numbers(path).length, numbers(GOLDEN_508).length, "same command shape");
});
