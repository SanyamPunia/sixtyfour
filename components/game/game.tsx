"use client";

import { useEffect, useReducer, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { isCapture, materialBalance } from "@/lib/chess/rules.ts";
import { BLACK, type Color, WHITE } from "@/lib/chess/types.ts";
import {
  checkedKingSquare,
  createGame,
  gameReducer,
  isGameOver,
  isHumanTurn,
  matedKingSquare,
  outcome,
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
import { StatusBar } from "./status-bar.tsx";
import { StatusRegion } from "./status-region.tsx";
import { useBot } from "./use-bot.ts";
import { useMoveSound } from "./use-move-sound.ts";

export function Game() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => createGame());
  const [muted, setMutedState] = useState(false);
  useBot(state, dispatch);

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
          the page padding plus the controls.
        */}
        <div className="flex w-full max-w-[min(100%,calc(100dvh-18rem))] flex-col gap-6">
          <StatusBar
            yourTurn={state.position.side === state.humanColor}
            thinking={state.thinking}
            outcome={outcome(state)}
            materialLead={materialLead}
          />
          <Board
            position={state.position}
            pieces={state.pieces}
            humanColor={state.humanColor}
            selected={state.selected}
            legalTargets={state.legalTargets}
            lastMove={state.lastMove}
            checkedKing={checkedKingSquare(state)}
            matedKing={matedKingSquare(state)}
            castlingRookId={state.castlingRookId}
            interactive={isHumanTurn(state)}
            flipped={state.humanColor === BLACK}
            shakeToken={state.shakeToken}
            resetToken={state.resetToken}
            pendingPromotion={state.pendingPromotion}
            over={isGameOver(state.status)}
            onPromote={(piece) => dispatch({ type: "promote", piece })}
            onCancelPromotion={() => dispatch({ type: "cancelPromotion" })}
            onGrab={(square) => dispatch({ type: "grab", square })}
            onSelect={(square) => dispatch({ type: "select", square })}
          />
          <ControlBar
            difficulty={state.difficulty}
            thinking={state.thinking}
            moveCount={state.history.length}
            attention={isGameOver(state.status)}
            humanColor={state.humanColor}
            muted={muted}
            onSide={changeSide}
            onToggleMute={toggleMute}
            onDifficulty={changeDifficulty}
            onNewGame={() => dispatch({ type: "newGame" })}
          />
        </div>
      </main>
    </TooltipProvider>
  );
}
