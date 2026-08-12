"use client";

import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils.ts";

interface NewGameButtonProps {
  /** A game with no moves has nothing to lose, so it restarts without asking. */
  hasProgress: boolean;
  moveCount: number;
  onNewGame: () => void;
}

export function NewGameButton({ hasProgress, moveCount, onNewGame }: NewGameButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [spinToken, setSpinToken] = useState(0);

  const start = () => {
    setSpinToken((n) => n + 1);
    onNewGame();
  };

  return (
    <>
      <Tooltip label="New game">
        <Button
          aria-label="New game"
          onClick={() => (hasProgress ? setConfirming(true) : start())}
        >
          <RotateCcwIcon
            // Remounting on the token is what replays the spin on every press.
            key={spinToken}
            className={cn("size-[18px]", spinToken > 0 && "icon-spin")}
            aria-hidden="true"
          />
        </Button>
      </Tooltip>

      {/*
        Rendered at this component's root rather than inside a popover, so it cannot be
        unmounted mid-interaction, and it acts before it closes.
      */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Start a new game?"
        description={`This game has ${moveCount} ${moveCount === 1 ? "move" : "moves"} played. Starting again discards it, and there is no undo.`}
        confirmLabel="New game"
        onConfirm={() => {
          start();
          setConfirming(false);
        }}
      />
    </>
  );
}
