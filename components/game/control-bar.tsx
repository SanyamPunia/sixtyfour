"use client";

import type { Color } from "@/lib/chess/types.ts";
import type { Difficulty } from "@/lib/game/reducer.ts";
import { DifficultyButton } from "./difficulty-button.tsx";
import { MuteButton } from "./mute-button.tsx";
import { NewGameButton } from "./new-game-button.tsx";
import { SideButton } from "./side-button.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

interface ControlBarProps {
  difficulty: Difficulty;
  humanColor: Color;
  muted: boolean;
  thinking: boolean;
  moveCount: number;
  /** The game is over, so new game is the only thing left to do. */
  attention: boolean;
  onSide: (color: Color) => void;
  onToggleMute: () => void;
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
  humanColor,
  muted,
  thinking,
  moveCount,
  attention,
  onSide,
  onToggleMute,
  onDifficulty,
  onNewGame,
}: ControlBarProps) {
  return (
    <div className="flex items-center justify-center gap-1">
      <ThemeToggle />
      <MuteButton muted={muted} onToggle={onToggleMute} />
      <SideButton
        humanColor={humanColor}
        hasProgress={moveCount > 0}
        moveCount={moveCount}
        onChange={onSide}
      />
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
