"use client";

import { TextMorph as Torph } from "torph/react";
import { cn } from "@/lib/utils.ts";

/**
 * The same spring the pieces slide on.
 *
 * `torph` takes stiffness and damping, which is the same parameterisation the CSS easings
 * in `globals.css` were sampled from, so this is literally the settle spring rather than a
 * second one tuned to look like it. Text that changes and a piece that moves are then the
 * same gesture, which is the only reason a text animation belongs in this product at all.
 */
const SETTLE = { stiffness: 320, damping: 30 } as const;

interface TextMorphProps {
  children: string;
  className?: string;
  /** Defaults to a span, which is what every call site here wants. */
  as?: "span" | "p";
}

/**
 * Text that changes into other text, rather than being replaced by it.
 *
 * Used where a label is answering a question that has just been answered differently:
 * whether the link is copied, whether the other player is there. In both cases the old and
 * the new text mean the same kind of thing, and swapping them outright reads as two
 * separate labels flickering rather than one label updating.
 *
 * Not for text that appears or disappears, and not for a number that counts. Those are
 * different motions and the project already has both.
 *
 * One surprise worth knowing about: every space in the rendered text becomes a non-breaking
 * space, which is how the segments are kept from wrapping apart mid-animation. So anything
 * matching on this text has to normalise whitespace first, and a plain `includes("two
 * words")` will silently never match. `scripts/verify.mjs` does exactly that.
 */
export function TextMorph({ children, className, as = "span" }: TextMorphProps) {
  return (
    <Torph
      as={as}
      ease={SETTLE}
      // Left on deliberately. Someone who has asked their system for less motion is asking
      // for exactly this kind of thing to stop.
      respectReducedMotion
      className={cn("inline-block", className)}
    >
      {children}
    </Torph>
  );
}
