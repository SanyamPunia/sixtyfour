"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { BLACK, type Color, PAWN, WHITE } from "@/lib/chess/types.ts";
import { PieceGlyph } from "./pieces/glyphs.tsx";

interface SideButtonProps {
  humanColor: Color;
  hasProgress: boolean;
  moveCount: number;
  onChange: (color: Color) => void;
}

/**
 * Switch which colour you play.
 *
 * The icon is a pawn in the fill of the side you are on, which is the same language the
 * board already uses, so it needs no legend.
 *
 * Changing sides starts a new game, because there is no meaningful way to swap colours
 * halfway through one. That makes it as consequential as the new game button, so it asks
 * the same question when there is a game to lose.
 */
export function SideButton({ humanColor, hasProgress, moveCount, onChange }: SideButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const next: Color = humanColor === WHITE ? BLACK : WHITE;
  const nextName = next === WHITE ? "white" : "black";

  return (
    <>
      <Tooltip label={`Play as ${nextName}`}>
        <Button
          aria-label={`Play as ${nextName}. Starts a new game`}
          onClick={() => (hasProgress ? setConfirming(true) : onChange(next))}
        >
          <span className="block size-[18px]">
            <PieceGlyph type={PAWN} own={true} />
          </span>
        </Button>
      </Tooltip>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Play as ${nextName}?`}
        description={`This game has ${moveCount} ${moveCount === 1 ? "move" : "moves"} played. Switching sides starts a new one, and there is no undo.`}
        confirmLabel={`Play as ${nextName}`}
        onConfirm={() => {
          onChange(next);
          setConfirming(false);
        }}
      />
    </>
  );
}
