"use client";

import { cn } from "@/lib/utils.ts";

interface TurnDotProps {
  yourTurn: boolean;
  thinking: boolean;
  over: boolean;
  /** True when it is White's move. White always moves first. */
  whiteToMove: boolean;
}

/**
 * A small dot that breathes while it is your move.
 *
 * It is drawn in the colour of the side to move, using the same two fills as the pieces, so
 * it answers "whose turn" and "which side is that" at once. It breathes while the move is
 * yours and goes still while the bot searches, which pairs with the difficulty icon running
 * as an equaliser: one says whose turn it is, the other says work is happening.
 *
 * It is 6px. Anything that announced the turn more loudly than the board itself would be
 * the loudest thing on a page whose only other text is one number.
 */
export function TurnDot({ yourTurn, thinking, over, whiteToMove }: TurnDotProps) {
  return (
    <span
      aria-hidden="true"
      data-active={yourTurn && !over ? "true" : undefined}
      className={cn("turn-dot block size-2 shrink-0 rounded-full")}
      style={{
        background: whiteToMove ? "var(--piece-white)" : "var(--piece-black)",
        // A ring, because a white dot on a light surface and a black one on a dark surface
        // both need an edge for the same reason the pieces do.
        boxShadow: `0 0 0 1px ${whiteToMove ? "var(--piece-white-edge)" : "var(--piece-black-edge)"}`,
        opacity: over ? 0.25 : thinking ? 0.45 : 1,
      }}
    />
  );
}
