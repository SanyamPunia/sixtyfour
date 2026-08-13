"use client";

import type { Presence } from "@/lib/room/protocol.ts";

interface PresenceDotProps {
  presence: Presence;
  /** Rendered for assistive technology, since the dot itself says nothing out loud. */
  label?: string;
}

const WORDS: Record<Presence, string> = {
  here: "Opponent is here",
  away: "Opponent is away",
  gone: "Waiting for an opponent",
};

/**
 * Whether the person on the other side of the board is actually there.
 *
 * Three states rather than two. A socket drops every time a phone locks or a laptop lid
 * closes for a moment, and calling that "disconnected" makes the indicator flicker through
 * an interruption neither player noticed. `away` is the honest middle: they were here a
 * moment ago and have not said goodbye.
 *
 * Same size as the turn dot beside it, because they are the same kind of statement.
 */
export function PresenceDot({ presence, label }: PresenceDotProps) {
  const filled = presence !== "gone";
  return (
    <span
      role="img"
      aria-label={label ?? WORDS[presence]}
      data-presence={presence}
      className="presence-dot block size-2 shrink-0 rounded-full"
      style={{
        background:
          presence === "here"
            ? "var(--presence-here)"
            : presence === "away"
              ? "var(--presence-away)"
              : "transparent",
        // A ring with nothing in it, for a seat nobody is sitting in.
        boxShadow: filled ? "none" : "inset 0 0 0 1.5px var(--presence-gone)",
      }}
    />
  );
}

export function presenceWords(presence: Presence): string {
  return WORDS[presence];
}
