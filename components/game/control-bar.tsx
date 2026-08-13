"use client";

import type { Difficulty } from "@/lib/game/reducer.ts";
import { DifficultyButton } from "./difficulty-button.tsx";
import { NewGameButton } from "./new-game-button.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

interface ControlBarProps {
  difficulty: Difficulty;
  thinking: boolean;
  moveCount: number;
  /** The game is over, so new game is the only thing left to do. */
  attention: boolean;
  onDifficulty: (next: Difficulty) => void;
  onNewGame: () => void;
}

/**
 * One evenly spaced, centred group.
 *
 * The material readout used to sit in this row, absolutely pinned to the right while the
 * buttons stayed centred. That put an arbitrary gap between them that grew with the
 * viewport, and gave a non-interactive number the exact size, shape and fill of the two
 * buttons beside it. It now sits above the board, where it reads as a caption rather than
 * as a control nobody can press.
 */
export function ControlBar({
  difficulty,
  thinking,
  moveCount,
  attention,
  onDifficulty,
  onNewGame,
}: ControlBarProps) {
  return (
    <div className="flex items-center justify-center gap-1">
      <ThemeToggle />
      <DifficultyButton difficulty={difficulty} thinking={thinking} onChange={onDifficulty} />
      <NewGameButton
        hasProgress={moveCount > 0}
        moveCount={moveCount}
        attention={attention}
        onNewGame={onNewGame}
      />
    </div>
  );
}
