"use client";

import type { Color } from "@/lib/chess/types.ts";
import type { Difficulty, GameState } from "@/lib/game/reducer.ts";
import { DifficultyButton } from "./difficulty-button.tsx";
import { MuteButton } from "./mute-button.tsx";
import { NewGameButton } from "./new-game-button.tsx";
import { RematchButton } from "./rematch-button.tsx";
import { RoomButton } from "./room-button.tsx";
import { ShareButton } from "./share-button.tsx";
import { SideButton } from "./side-button.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";
import type { RoomControls, RoomView } from "./use-room.ts";

interface ControlBarProps {
  difficulty: Difficulty;
  humanColor: Color;
  muted: boolean;
  thinking: boolean;
  moveCount: number;
  /** The game is over, so starting again is the only thing left to do. */
  attention: boolean;
  inRoom: boolean;
  /** Read only for the shared picture, which needs the whole finished position. */
  state: GameState;
  flipped: boolean;
  room: RoomView;
  roomControls: RoomControls;
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
 *
 * Two of these controls are about the bot and do not survive into a room. Difficulty has
 * nothing to set, and your side is whichever seat you took. Leaving them on screen as
 * disabled controls would be five greyed-out buttons around one that works.
 */
export function ControlBar({
  difficulty,
  humanColor,
  muted,
  thinking,
  moveCount,
  attention,
  inRoom,
  state,
  flipped,
  room,
  roomControls,
  onSide,
  onToggleMute,
  onDifficulty,
  onNewGame,
}: ControlBarProps) {
  return (
    <div className="flex items-center justify-center gap-1">
      <ThemeToggle />
      <MuteButton muted={muted} onToggle={onToggleMute} />
      {inRoom ? null : (
        <>
          <SideButton
            humanColor={humanColor}
            hasProgress={moveCount > 0}
            moveCount={moveCount}
            onChange={onSide}
          />
          <DifficultyButton
            difficulty={difficulty}
            thinking={thinking}
            onChange={onDifficulty}
          />
        </>
      )}
      <RoomButton room={room} controls={roomControls} />
      {/* Only rendered once there is a result, so it appears exactly when it is useful. */}
      <ShareButton state={state} flipped={flipped} />
      {inRoom ? (
        <RematchButton
          enabled={attention}
          attention={attention}
          onRematch={roomControls.rematch}
        />
      ) : (
        <NewGameButton
          hasProgress={moveCount > 0}
          moveCount={moveCount}
          attention={attention}
          onNewGame={onNewGame}
        />
      )}
    </div>
  );
}
