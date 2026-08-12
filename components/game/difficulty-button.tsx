"use client";

import { Button } from "@/components/ui/button.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils.ts";
import type { Difficulty } from "./reducer.ts";

const ORDER: readonly Difficulty[] = ["easy", "medium", "hard"];

/** How many bars are lit at each level. */
const LIT: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

/** Three bars, thin. The level is carried by opacity, the height only gives it a shape. */
/**
 * Three bars, sized to sit optically level with the moon and the rotate arrow beside it.
 * Lucide icons fill about 18 of their 24 units, so these do too. Matching the nominal
 * pixel size is not enough: a shorter glyph in the same box reads as a smaller control.
 */
const BARS = [
  { x: 4.5, y: 13, height: 7 },
  { x: 10.4, y: 9, height: 11 },
  { x: 16.3, y: 4, height: 16 },
] as const;

interface DifficultyButtonProps {
  difficulty: Difficulty;
  /** While the bot searches, the bars run as an equaliser instead of showing the level. */
  thinking: boolean;
  onChange: (next: Difficulty) => void;
}

/**
 * One button that cycles the three levels, and doubles as the thinking indicator.
 *
 * Reusing the bars for the wait is the whole reason the page needs no spinner: the only
 * chrome on screen is already a set of three bars, so animating them costs nothing and
 * adds no element.
 */
export function DifficultyButton({ difficulty, thinking, onChange }: DifficultyButtonProps) {
  const next = ORDER[(ORDER.indexOf(difficulty) + 1) % ORDER.length] as Difficulty;
  const lit = LIT[difficulty];

  return (
    <>
      <Tooltip label={`Difficulty: ${difficulty}. Tap for ${next}`}>
        <Button
          aria-label={`Bot difficulty: ${difficulty}. Change to ${next}`}
          onClick={() => onChange(next)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            {BARS.map((bar, index) => (
              <rect
                key={bar.x}
                x={bar.x}
                y={bar.y}
                width="3.2"
                height={bar.height}
                rx="1.6"
                fill="currentColor"
                className={cn(thinking && "bar-equalise")}
                style={{
                  opacity: thinking || index < lit ? 1 : 0.28,
                  transition: "opacity 200ms var(--ease-pop)",
                  transitionDelay: `${index * 40}ms`,
                  ["--bar-index" as string]: index,
                }}
              />
            ))}
          </svg>
        </Button>
      </Tooltip>
      {/* Announced separately from the game status so a level change is not missed. */}
      <p aria-live="polite" className="sr-only">
        {difficulty}
      </p>
    </>
  );
}
