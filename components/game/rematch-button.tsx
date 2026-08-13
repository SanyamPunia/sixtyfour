"use client";

import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils.ts";

interface RematchButtonProps {
  /** Only once the game is decided. Clearing a live board is the opponent's business too. */
  enabled: boolean;
  attention: boolean;
  onRematch: () => void;
}

/**
 * Play again, in the same room, with the same two people.
 *
 * No confirm step, unlike the single-player restart. There is nothing to lose: the button
 * is only live once the game is over, so the position it clears is one neither player can
 * do anything with.
 */
export function RematchButton({ enabled, attention, onRematch }: RematchButtonProps) {
  const [spinToken, setSpinToken] = useState(0);

  return (
    <Tooltip label={enabled ? "Play again" : "Play again, once this game ends"}>
      {/* Wrapped, because a disabled button fires no pointer events and so no tooltip. */}
      <span className="inline-flex">
        <Button
          aria-label="Play again"
          disabled={!enabled}
          data-attention={attention || undefined}
          onClick={() => {
            setSpinToken((n) => n + 1);
            onRematch();
          }}
        >
          <RotateCcwIcon
            key={spinToken}
            className={cn("size-[18px]", spinToken > 0 && "icon-spin")}
            aria-hidden="true"
          />
        </Button>
      </span>
    </Tooltip>
  );
}
