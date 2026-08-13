/**
 * The piece set.
 *
 * One body, six marks. Every piece stands on the same stem and foot, and only the shape
 * above it says which piece it is. That is the whole system.
 *
 * The earlier set gave each piece its own construction: crenellations plus a collar plus a
 * taper on the rook, three separate beads on the queen. Four or five shapes per silhouette
 * read fine at 52px and turned to mush at 40px, where silhouette is the only channel a
 * piece has. It also put more decoration on the pieces than anywhere else on a surface
 * that has no text and two square tones four percent apart.
 *
 * Everything here is drawn for this project. Do not paste in path data from a piece set,
 * free or otherwise. See CLAUDE.md rule 0.
 */

import type { PieceType } from "@/lib/chess/types.ts";
import { BISHOP, KING, KNIGHT, PAWN, QUEEN, ROOK } from "@/lib/chess/types.ts";

/**
 * Stem and foot, shared by all six.
 *
 * Rendered as its own element rather than concatenated into the mark's `d`. A single path
 * applies one fill rule across both shapes, and where the knight overlapped the body their
 * winding directions opposed, so nonzero punched the overlap out as a white hole. Separate
 * elements each fill independently and union.
 */
const BODY =
  "M13 15.4h6l1.15 8.1h1.35c1.02 0 1.91.69 2.16 1.68l.5 2a1.4 1.4 0 0 1-1.36 1.74" +
  "H9.2a1.4 1.4 0 0 1-1.36-1.74l.5-2a2.23 2.23 0 0 1 2.16-1.68h1.35z";

const MARKS: Record<PieceType, string> = {
  // A circle. Nothing else.
  [PAWN]: "M16 5.6a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2z",

  // A point. Taller than the pawn's circle and it comes to a tip, which is the only
  // difference the two need at 40px.
  [BISHOP]: "M16 3.4c2.75 2.9 4.7 6.06 4.7 8.4a4.7 4.7 0 1 1-9.4 0c0-2.34 1.95-5.5 4.7-8.4z",

  // Two notches. Three merlons is the fewest that still reads as a rook.
  [ROOK]:
    "M9.2 5.8h3.5v2.4h1.55V5.8h3.5v2.4h1.55V5.8h3.5v7.9a1.4 1.4 0 0 1-1.4 1.4H10.6" +
    "a1.4 1.4 0 0 1-1.4-1.4z",

  // A crown, as one zigzag. The three beads it replaces were invisible below 48px.
  [QUEEN]: "M10.1 15.2 8.3 6.9l4.35 3.5L16 4.6l3.35 5.8L23.7 6.9l-1.8 8.3z",

  // A cross, which is the king's alone.
  [KING]:
    "M14.75 3.6h2.5a.7.7 0 0 1 .7.7v2.4h2.4a.7.7 0 0 1 .7.7v2.5a.7.7 0 0 1-.7.7h-2.4" +
    "v4.6h-3.9v-4.6h-2.4a.7.7 0 0 1-.7-.7V7.4a.7.7 0 0 1 .7-.7h2.4V4.3a.7.7 0 0 1 .7-.7z",

  // The one piece that cannot be reduced to a mark on a stem, because a horse head is the
  // only thing that reads as a knight. Kept to a single outline with no interior detail.
  [KNIGHT]:
    "M18.3 4.4c-.62-.4-1.42.09-1.35.82l.16 1.6-6.05 6.1a1.1 1.1 0 0 0-.1 1.42l1.15 1.6" +
    "c.34.48 1.01.6 1.5.27l3.36-2.28c.5-.34 1.18.02 1.18.63v3.02h-4.3" +
    "c-1.9 1.24-2.72 2.9-2.15 5.42h11.1a1.1 1.1 0 0 0 1-.64l2.5-5.42" +
    "c.42-1.03.66-2.16.66-3.34 0-3.97-2.6-7.34-6.2-8.5z",
};

export interface PieceGlyphProps {
  type: PieceType;
  /** The chess colour. White renders light and Black renders dark, in both themes. */
  white: boolean;
  /** Takes the fill from the surrounding text instead, for use as a control icon. */
  inherit?: boolean;
}

export function PieceGlyph({ type, white, inherit = false }: PieceGlyphProps) {
  const fill = inherit ? "currentColor" : white ? "var(--piece-white)" : "var(--piece-black)";

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="pointer-events-none size-full">
      <g style={{ fill }}>
        <path d={BODY} />
        <path d={MARKS[type]} />
      </g>
    </svg>
  );
}
