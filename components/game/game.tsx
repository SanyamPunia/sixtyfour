"use client";

import { useReducer } from "react";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { isCapture, materialBalance } from "@/lib/chess/rules.ts";
import { Board } from "./board.tsx";
import { ControlBar } from "./control-bar.tsx";
import {
  checkedKingSquare,
  createGame,
  gameReducer,
  isGameOver,
  isHumanTurn,
  matedKingSquare,
} from "./reducer.ts";
import { StatusBar } from "./status-bar.tsx";
import { StatusRegion } from "./status-region.tsx";
import { useBot } from "./use-bot.ts";
import { useMoveSound } from "./use-move-sound.ts";

export function Game() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => createGame());
  useBot(state, dispatch);
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
            over={isGameOver(state.status)}
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
            shakeToken={state.shakeToken}
            resetToken={state.resetToken}
            onGrab={(square) => dispatch({ type: "grab", square })}
            onSelect={(square) => dispatch({ type: "select", square })}
          />
          <ControlBar
            difficulty={state.difficulty}
            thinking={state.thinking}
            moveCount={state.history.length}
            onDifficulty={(difficulty) => dispatch({ type: "setDifficulty", difficulty })}
            onNewGame={() => dispatch({ type: "newGame" })}
          />
        </div>
      </main>
    </TooltipProvider>
  );
}
