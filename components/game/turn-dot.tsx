"use client";

import { cn } from "@/lib/utils.ts";

interface TurnDotProps {
  yourTurn: boolean;
  thinking: boolean;
  over: boolean;
}

/**
 * A small dot that breathes while it is your move.
 *
 * It is drawn in `--piece-own`, the same fill as your pieces, so the link between "this
 * colour is mine" and "it is my turn" needs no explaining. While the bot searches it goes
 * still and dims, which pairs with the difficulty icon running as an equaliser: one says
 * whose turn it is, the other says work is happening.
 *
 * It is 6px. Anything that announced the turn more loudly than the board itself would be
 * the loudest thing on a page whose only other text is one number.
 */
export function TurnDot({ yourTurn, thinking, over }: TurnDotProps) {
  return (
    <span
      aria-hidden="true"
      data-active={yourTurn && !over ? "true" : undefined}
      className={cn("turn-dot block size-1.5 shrink-0 rounded-full")}
      style={{
        background: yourTurn && !over ? "var(--piece-own)" : "var(--ink-soft)",
        opacity: over ? 0.25 : thinking ? 0.4 : 1,
      }}
    />
  );
}
