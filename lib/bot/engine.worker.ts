/// <reference lib="webworker" />

/**
 * The search, off the main thread.
 *
 * The hard level is given a 400ms budget, and running that on the main thread would stall
 * every animation on the board for its whole duration. Moves cross the boundary as plain
 * coordinates rather than as `Move` objects, because the caller can re-derive the full
 * move by matching against its own legal list, and that also means a malformed reply can
 * never put an illegal move on the board.
 */

import { parseFen } from "../chess/board.ts";
import { chooseMove, type Difficulty } from "./levels.ts";

export interface BotRequest {
  id: number;
  fen: string;
  difficulty: Difficulty;
  random: number;
}

export interface BotResponse {
  id: number;
  from: number;
  to: number;
  promo: number;
  depth: number;
  nodes: number;
  elapsedMs: number;
}

self.onmessage = (event: MessageEvent<BotRequest>) => {
  const { id, fen, difficulty, random } = event.data;
  const position = parseFen(fen);
  const choice = chooseMove(position, difficulty, random);

  if (choice.move === null) {
    self.postMessage({ id, from: -1, to: -1, promo: 0, depth: 0, nodes: 0, elapsedMs: 0 });
    return;
  }

  self.postMessage({
    id,
    from: choice.move.from,
    to: choice.move.to,
    promo: choice.move.promo,
    depth: choice.depth,
    nodes: choice.nodes,
    elapsedMs: choice.elapsedMs,
  } satisfies BotResponse);
};
