import type { Color } from "@/lib/chess/types.ts";
import { columnOf, type PieceView, rowOf } from "@/lib/game/piece-state.ts";
import { cn } from "@/lib/utils.ts";
import { PieceGlyph } from "./pieces/glyphs.tsx";

interface PieceProps {
  piece: PieceView;
  humanColor: Color;
  lifted: boolean;
  mated: boolean;
  /** The rook half of a castle, which trails the king by one beat. */
  castlingRook: boolean;
  flipped: boolean;
  /** Stagger index for the entrance, counted outward from the centre files. */
  enterDelay: number;
}

/**
 * One piece, positioned by transform rather than by living inside a square.
 *
 * The layering is deliberate. The outer element owns `translate`, so a move animates as
 * one transition. The inner body owns `scale`, `opacity`, and the shadow, so a lift or a
 * capture animates at the same time without either overwriting the other's transform.
 */
export function Piece({
  piece,
  humanColor,
  lifted,
  mated,
  castlingRook,
  flipped,
  enterDelay,
}: PieceProps) {
  const column = columnOf(piece.square, flipped);
  const row = rowOf(piece.square, flipped);

  // A moving or lifted piece rides over the piece it is taking.
  const zIndex = lifted ? 3 : piece.captured ? 1 : 2;

  return (
    <div
      className={cn("piece absolute top-0 left-0 size-[12.5%]")}
      data-lifted={lifted || undefined}
      data-captured={piece.captured || undefined}
      data-castling-rook={castlingRook || undefined}
      data-mated={mated || undefined}
      data-piece-id={piece.id}
      data-square={piece.square}
      style={{
        transform: `translate(${column * 100}%, ${row * 100}%)`,
        zIndex,
        ["--enter-delay" as string]: enterDelay,
      }}
    >
      <div className="piece-body size-full p-[6%]">
        <PieceGlyph type={piece.type} own={piece.color === humanColor} />
      </div>
    </div>
  );
}
