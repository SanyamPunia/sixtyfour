/**
 * Continuous ("squircle") corners as an SVG path.
 *
 * A rounded corner is one arc. A continuous corner is a cubic, then a shorter arc, then a
 * mirrored cubic, so curvature ramps in and out instead of switching on at the tangent
 * point. `smoothing` is how much of the corner the cubics take: 0 is a plain rounded rect
 * and 1 removes the arc entirely.
 *
 * `corner-shape: squircle` does this natively but only in Chromium, so the path is what
 * ships and the CSS property is a progressive enhancement.
 */

const toRadians = (deg: number): number => (deg * Math.PI) / 180;
const round = (n: number): number => Math.round(n * 1e4) / 1e4;

export interface SquircleOptions {
  width: number;
  height: number;
  radius: number;
  /** 0 to 1. Defaults to the value the board uses. */
  smoothing?: number;
}

export function squirclePath({
  width,
  height,
  radius,
  smoothing = 0.6,
}: SquircleOptions): string {
  // A corner cannot eat more than half the shorter side.
  const r = Math.min(radius, Math.min(width, height) / 2 / (1 + smoothing));
  const footprint = (1 + smoothing) * r;
  const arcSweep = 90 * (1 - smoothing);
  const arcChord = Math.sin(toRadians(arcSweep / 2)) * r * Math.SQRT2;
  const alpha = (90 - arcSweep) / 2;

  const c = r * Math.tan(toRadians((45 * smoothing) / 2)) * Math.cos(toRadians(alpha));
  const d = c * Math.tan(toRadians(alpha));
  const b = (footprint - arcChord - c - d) / 3;
  const a = 2 * b;

  /**
   * Each corner is drawn in a local frame where `u` runs along the incoming edge and `v`
   * turns into the corner. These four maps rotate that frame onto the real axes, going
   * clockwise from the top left.
   */
  const turns: ReadonlyArray<(u: number, v: number) => [number, number]> = [
    (u, v) => [u, v],
    (u, v) => [-v, u],
    (u, v) => [-u, -v],
    (u, v) => [v, -u],
  ];

  const corner = (index: number): string => {
    const turn = turns[index] as (u: number, v: number) => [number, number];
    const point = (u: number, v: number): string => turn(u, v).map(round).join(" ");
    return (
      `c ${point(a, 0)} ${point(a + b, 0)} ${point(a + b + c, d)} ` +
      `a ${round(r)} ${round(r)} 0 0 1 ${point(arcChord, arcChord)} ` +
      `c ${point(d, c)} ${point(d, c + b)} ${point(d, c + b + a)}`
    );
  };

  const p = round(footprint);
  const w = round(width);
  const h = round(height);
  return (
    `M ${p} 0 L ${round(width - footprint)} 0 ${corner(0)} ` +
    `L ${w} ${p} L ${w} ${round(height - footprint)} ${corner(1)} ` +
    `L ${round(width - footprint)} ${h} L ${p} ${h} ${corner(2)} ` +
    `L 0 ${round(height - footprint)} L 0 ${p} ${corner(3)} Z`
  );
}
