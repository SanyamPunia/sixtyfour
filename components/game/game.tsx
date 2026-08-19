"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { isCapture, materialBalance } from "@/lib/chess/rules.ts";
import { BLACK, type Color, WHITE } from "@/lib/chess/types.ts";
import { moveLog } from "@/lib/game/move-log.ts";
import {
  checkedKingSquare,
  createGame,
  gameReducer,
  isHumanTurn,
  isOver,
  matedKingSquare,
  outcome,
  resultLabel,
} from "@/lib/game/reducer.ts";
import {
  readDifficulty,
  readMuted,
  readSide,
  writeDifficulty,
  writeMuted,
  writeSide,
} from "@/lib/preferences.ts";
import { setMuted } from "@/lib/sound.ts";
import { Board } from "./board.tsx";
import { ControlBar } from "./control-bar.tsx";
import { MoveList } from "./move-list.tsx";
import { StatusBar } from "./status-bar.tsx";
import { StatusRegion } from "./status-region.tsx";
import { useBot } from "./use-bot.ts";
import { useMoveSound } from "./use-move-sound.ts";
import { useRoom } from "./use-room.ts";

export function Game() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => createGame());
  const [muted, setMutedState] = useState(false);
  // Both hooks are always mounted, and `state.opponent` decides which one is live. A hook
  // cannot be conditional, and a game that switches between the two would otherwise have
  // to unmount and remount the board.
  useBot(state, dispatch);
  const [room, roomControls] = useRoom(state, dispatch);
  const inRoom = state.opponent === "room";

  const moves = useMemo(
    () => moveLog(state.history, state.humanColor),
    [state.history, state.humanColor],
  );

  /*
   * Which move the list is pointing at, held as an index into `moves`.
   *
   * React state rather than a ref, unlike the board's own hover, because the mark is
   * rendered output and has to re-render to change. The board avoids state there because
   * pointer movement across 64 squares fires continuously. A row boundary is crossed once
   * per row, which is a different order of frequency entirely.
   *
   * Resolved through the list rather than stored as two squares, so a room that rolls a move
   * back leaves nothing marking a move that never happened.
   */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewed = previewIndex === null ? undefined : moves[previewIndex - 1];

  /*
   * Stored choices are applied on mount rather than read while building the initial state.
   *
   * The reducer's initialiser runs on the server too, where there is no localStorage, and
   * branching on that is what produces a hydration mismatch. One frame of the default
   * lands inside the piece entrance animation, so nothing is visible.
   */
  useEffect(() => {
    const difficulty = readDifficulty();
    if (difficulty !== null) dispatch({ type: "setDifficulty", difficulty });

    const side = readSide();
    if (side === "black") dispatch({ type: "setSide", color: BLACK });

    const storedMute = readMuted();
    if (storedMute) {
      setMuted(true);
      setMutedState(true);
    }
  }, []);

  const changeDifficulty = (difficulty: typeof state.difficulty): void => {
    writeDifficulty(difficulty);
    dispatch({ type: "setDifficulty", difficulty });
  };

  const changeSide = (color: Color): void => {
    writeSide(color === WHITE ? "white" : "black");
    dispatch({ type: "setSide", color });
  };

  const toggleMute = (): void => {
    const next = !muted;
    setMuted(next);
    writeMuted(next);
    setMutedState(next);
  };
  // Whoever made it. The bot taking a piece sounds the same as the player doing it.
  const lastMove = state.history.at(-1);
  useMoveSound(state.history.length, lastMove !== undefined && isCapture(lastMove));

  // Positive when the human leads, whichever colour they are playing.
  const materialLead = materialBalance(state.position) * state.humanColor;

  return (
    <TooltipProvider>
      <main className="mx-auto flex min-h-dvh w-full max-w-[540px] flex-col items-center justify-center gap-10 px-4 py-12">
        <StatusRegion state={state} />
        {/*
          The board is capped against the viewport height as well as its width, so the
          board and the control row always fit without the page scrolling. 18rem covers
          the page padding plus the controls, and the 3.5rem on top of it covers the move
          strip, which is only in the flow below `lg`.
        */}
        <div className="relative flex w-full max-w-[min(100%,calc(100dvh-21.5rem))] flex-col gap-6 lg:max-w-[min(508px,calc(100dvh-18rem))]">
          <StatusBar
            yourTurn={state.position.side === state.humanColor}
            whiteToMove={state.position.side === WHITE}
            thinking={state.thinking}
            result={resultLabel(state)}
            materialLead={materialLead}
            waitingOn={inRoom ? room.opponent : null}
          />
          <Board
            position={state.position}
            pieces={state.pieces}
            humanColor={state.humanColor}
            selected={state.selected}
            legalTargets={state.legalTargets}
            lastMove={state.lastMove}
            preview={
              previewed === undefined ? null : { from: previewed.from, to: previewed.to }
            }
            checkedKing={checkedKingSquare(state)}
            matedKing={matedKingSquare(state)}
            castlingRookId={state.castlingRookId}
            interactive={isHumanTurn(state)}
            flipped={state.humanColor === BLACK}
            shakeToken={state.shakeToken}
            resetToken={state.resetToken}
            pendingPromotion={state.pendingPromotion}
            over={isOver(state)}
            celebrate={outcome(state) === "win"}
            onPromote={(piece) => dispatch({ type: "promote", piece })}
            onCancelPromotion={() => dispatch({ type: "cancelPromotion" })}
            onGrab={(square) => dispatch({ type: "grab", square })}
            onSelect={(square) => dispatch({ type: "select", square })}
          />
          {/*
            The strip holds its 2rem whether or not there is anything in it.
            Letting it appear with the first move would shift a centred board upward at the
            exact moment a pawn is sliding to e4, which is the one frame it must not move in.
          */}
          <div className="h-8 lg:hidden">
            <MoveList moves={moves} layout="strip" onPreview={setPreviewIndex} />
          </div>
          <ControlBar
            difficulty={state.difficulty}
            thinking={state.thinking}
            moveCount={state.history.length}
            attention={isOver(state)}
            humanColor={state.humanColor}
            muted={muted}
            inRoom={inRoom}
            state={state}
            flipped={state.humanColor === BLACK}
            room={room}
            roomControls={roomControls}
            onSide={changeSide}
            onToggleMute={toggleMute}
            onDifficulty={changeDifficulty}
            onNewGame={() => dispatch({ type: "newGame" })}
          />
          {/*
            Hung off the right edge rather than placed in a row with the board, so the board
            keeps the centre of the page and never moves. A panel in the flow would slide a
            centred board left by half its width the first time a move was played.

            `lg` is where it fits: a 508px board centred in 1024px leaves 258px to the right
            of it, and this asks for 176 plus a 16px gap.

            The inset is the board's own top and bottom edge, so the list is a column exactly
            as tall as the board rather than as the whole block. Both numbers come from the
            two rows it clears: the status bar is `h-5` and the controls are `size-10`, each
            plus this column's `gap-6`.
          */}
          <div className="absolute top-11 bottom-16 left-full ml-4 hidden w-44 lg:block">
            <MoveList moves={moves} layout="column" onPreview={setPreviewIndex} />
          </div>
        </div>
      </main>
    </TooltipProvider>
  );
}
