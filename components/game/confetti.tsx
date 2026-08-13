"use client";

/**
 * A small burst from the middle of the board when the player wins.
 *
 * No library and no canvas. Each piece is one element carrying its own angle, distance,
 * spin and delay as custom properties, and a single keyframe animation reads them. That is
 * the same mechanism the hint dots already use for their stagger.
 *
 * The layout is computed once at module scope from a fixed seed rather than randomised per
 * render. A burst does not need real randomness to look scattered, and `Math.random()` in
 * a render is exactly the hydration mismatch this project has already been bitten by.
 */

/** mulberry32, the same four lines the zobrist keys use, for the same reason. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Light and warm rather than saturated. These sit on a near-white board and on a near-black
 * one, which a fully saturated set does not: primaries go muddy on the light theme and
 * glare on the dark one.
 */
const COLOURS = ["#f7a8a8", "#f6cf87", "#9fd8bd", "#a3c7f2", "#c7b0e8", "#f4b6d2"];

const COUNT = 22;

const PIECES = Array.from({ length: COUNT }, (_, index) => {
  const random = rng(index * 2654435761 + 1);
  // Spread evenly around the circle first, then jitter, so no wedge is left bare.
  const angle = (index / COUNT) * Math.PI * 2 + (random() - 0.5) * 0.5;
  const distance = 62 + random() * 58;
  return {
    dx: Math.cos(angle) * distance,
    // Slightly flattened, so the burst reads as spreading across the board rather than
    // as a sphere seen head on.
    dy: Math.sin(angle) * distance * 0.78,
    fall: 26 + random() * 34,
    spin: (random() - 0.5) * 900,
    delay: random() * 90,
    size: 4 + Math.round(random() * 3),
    round: random() > 0.55,
    colour: COLOURS[index % COLOURS.length] as string,
  };
});

export function Confetti() {
  return (
    <div aria-hidden="true" className="confetti pointer-events-none absolute inset-0 z-20">
      {PIECES.map((piece, index) => (
        <i
          // The set is fixed, so the index is a stable identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: the array is a module constant and never reorders
          key={index}
          style={{
            background: piece.colour,
            width: piece.size,
            height: piece.round ? piece.size : piece.size * 2.1,
            borderRadius: piece.round ? "999px" : "1px",
            ["--dx" as string]: `${piece.dx.toFixed(1)}px`,
            ["--dy" as string]: `${piece.dy.toFixed(1)}px`,
            ["--fall" as string]: `${piece.fall.toFixed(1)}px`,
            ["--spin" as string]: `${piece.spin.toFixed(0)}deg`,
            ["--delay" as string]: `${piece.delay.toFixed(0)}ms`,
          }}
        />
      ))}
    </div>
  );
}
