/**
 * One piece, as an SVG.
 *
 * The paths live in `lib/pieces.ts`, because the shared image drawn on a win uses the same
 * ones and a second copy would drift.
 */

import type { PieceType } from "@/lib/chess/types.ts";
import { PIECE_BODY, PIECE_MARKS, PIECE_VIEWBOX } from "@/lib/pieces.ts";

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
    <svg
      viewBox={`0 0 ${PIECE_VIEWBOX} ${PIECE_VIEWBOX}`}
      aria-hidden="true"
      className="pointer-events-none size-full"
    >
      <g style={{ fill }}>
        <path d={PIECE_BODY} />
        <path d={PIECE_MARKS[type]} />
      </g>
    </svg>
  );
}
