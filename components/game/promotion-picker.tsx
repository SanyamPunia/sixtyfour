"use client";

import type { PromotionType } from "@/lib/chess/types.ts";
import { BISHOP, KNIGHT, QUEEN, ROOK } from "@/lib/chess/types.ts";
import { columnOf, rowOf } from "@/lib/game/piece-state.ts";
import { PieceGlyph } from "./pieces/glyphs.tsx";

/** Queen first, because it is the answer almost every time. */
const CHOICES: readonly PromotionType[] = [QUEEN, ROOK, BISHOP, KNIGHT];

const NAMES: Record<PromotionType, string> = {
  [QUEEN]: "queen",
  [ROOK]: "rook",
  [BISHOP]: "bishop",
  [KNIGHT]: "knight",
};

interface PromotionPickerProps {
  /** The square the pawn is arriving on. */
  square: number;
  flipped: boolean;
  /** The promoting side, so the choices are drawn in that colour. */
  white: boolean;
  onChoose: (piece: PromotionType) => void;
  onCancel: () => void;
}

/**
 * The four pieces a pawn can become, stacked from the promotion square.
 *
 * Anchored to the square rather than centred on the screen, so the choice appears where
 * the player is already looking. The stack runs toward the middle of the board, which for
 * a promotion on the eighth rank means downward, and never off the edge.
 *
 * A scrim behind it takes a click as a cancel. Backing out has to be possible: the move is
 * not played until one of these is chosen.
 */
export function PromotionPicker({
  square,
  flipped,
  white,
  onChoose,
  onCancel,
}: PromotionPickerProps) {
  const column = columnOf(square, flipped);
  const row = rowOf(square, flipped);
  // Promoting on the near edge would run the stack off the board, so it flips upward.
  const downward = row <= 3;

  return (
    <>
      <button
        type="button"
        aria-label="Cancel promotion"
        className="absolute inset-0 z-10 cursor-default"
        style={{ background: "color-mix(in oklch, var(--surface) 74%, transparent)" }}
        onClick={onCancel}
      />
      {/*
        No wrapper role. Each button already announces itself as "Promote to queen" and
        so on, which is the whole message, and a group role here only adds a layer for a
        screen reader to walk through.
      */}
      <div
        className="promo-stack absolute top-0 left-0 z-20 flex flex-col"
        style={{
          width: "12.5%",
          transform: `translate(${column * 100}%, ${downward ? row * 100 : (row - 3) * 100}%)`,
          flexDirection: downward ? "column" : "column-reverse",
        }}
      >
        {CHOICES.map((piece) => (
          <button
            key={piece}
            type="button"
            aria-label={`Promote to ${NAMES[piece]}`}
            className="promo-choice aspect-square w-full cursor-pointer p-[6%]"
            onClick={() => onChoose(piece)}
          >
            <PieceGlyph type={piece} white={white} />
          </button>
        ))}
      </div>
    </>
  );
}
