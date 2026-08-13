"use client";

import { useEffect, useRef } from "react";
import type { BotResponse } from "@/lib/bot/engine.worker.ts";
import { chooseMove, THINK_FLOOR_MS } from "@/lib/bot/levels.ts";
import { toFen } from "@/lib/chess/board.ts";
import { legalMoves } from "@/lib/chess/rules.ts";
import type { Move } from "@/lib/chess/types.ts";
import type { GameAction, GameState } from "@/lib/game/reducer.ts";
import { isGameOver } from "@/lib/game/reducer.ts";

/**
 * Runs the bot when it is the bot's turn.
 *
 * Two things are load bearing here.
 *
 * The search happens in a worker, so a 400ms hard-level search never stalls the board's
 * animations. If the worker cannot start, the search falls back to the main thread rather
 * than leaving the game stuck with no opponent.
 *
 * And the reply is held until `THINK_FLOOR_MS` has passed. The search usually answers in
 * single-digit milliseconds, and a move that lands that fast does not read as a move. The
 * wait is the interaction, not a limitation.
 */
export function useBot(state: GameState, dispatch: (action: GameAction) => void): void {
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => {
    try {
      workerRef.current = new Worker(
        new URL("../../lib/bot/engine.worker.ts", import.meta.url),
      );
    } catch {
      // Falls through to the main-thread path below.
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // In a room the other side of the board is a person, and the bot must not answer for
  // them. This is the only line in the bot that knows rooms exist.
  const botToMove =
    state.opponent === "bot" &&
    !isGameOver(state.status) &&
    state.position.side !== state.humanColor;

  useEffect(() => {
    if (!botToMove) return;

    let cancelled = false;
    const startedAt = performance.now();
    requestId.current += 1;
    const id = requestId.current;
    const fen = toFen(state.position);
    const random = Math.random();

    const commit = (from: number, to: number, promo: number): void => {
      if (cancelled) return;
      // Re-derive the move from our own legal list. Coordinates that do not match a legal
      // move are dropped rather than trusted.
      const match = legalMoves(state.position).find(
        (m: Move) => m.from === from && m.to === to && (promo === 0 || m.promo === promo),
      );
      if (match === undefined) return;

      const wait = Math.max(0, THINK_FLOOR_MS - (performance.now() - startedAt));
      const timer = setTimeout(() => {
        if (!cancelled) dispatchRef.current({ type: "play", move: match });
      }, wait);
      cleanup.push(() => clearTimeout(timer));
    };

    const cleanup: Array<() => void> = [];
    const worker = workerRef.current;

    if (worker !== null) {
      const onMessage = (event: MessageEvent<BotResponse>) => {
        if (event.data.id !== id) return;
        commit(event.data.from, event.data.to, event.data.promo);
      };
      worker.addEventListener("message", onMessage);
      cleanup.push(() => worker.removeEventListener("message", onMessage));
      worker.postMessage({ id, fen, difficulty: state.difficulty, random });
    } else {
      const choice = chooseMove(state.position, state.difficulty, random);
      if (choice.move !== null) {
        commit(choice.move.from, choice.move.to, choice.move.promo);
      }
    }

    dispatchRef.current({ type: "beginThinking" });

    return () => {
      cancelled = true;
      for (const undo of cleanup) undo();
    };
    // `state.position` is a new object per move and stable in between, so this runs
    // exactly once per position rather than on every unrelated state change.
  }, [botToMove, state.position, state.difficulty]);
}
