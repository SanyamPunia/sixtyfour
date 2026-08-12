/**
 * The three difficulties.
 *
 * The engine is far stronger than this product needs, so the levels are mostly about
 * holding it back in ways that still feel like an opponent rather than a random-move
 * generator. Easy still refuses to hang a piece for nothing, because a bot that gives
 * away its queen is not easy, it is broken.
 */

import type { Move, Position } from "../chess/types.ts";
import { type ScoredMove, type SearchConfig, search } from "./search.ts";

export type Difficulty = "easy" | "medium" | "hard";

interface LevelConfig extends SearchConfig {
  /**
   * How far below the best score a move may be and still get picked, in centipawns.
   * This is what makes a level feel like a personality instead of a depth number.
   */
  slack: number;
}

const LEVELS: Record<Difficulty, LevelConfig> = {
  // One ply plus quiescence: it sees a free piece and it sees the recapture, nothing more.
  easy: { maxDepth: 1, timeBudgetMs: 60, slack: 250 },
  // Enough to punish a two-move tactic, not enough to see a plan.
  medium: { maxDepth: 3, timeBudgetMs: 150, slack: 60 },
  // Iterative deepening under a real budget, which usually reaches depth 5 to 7.
  hard: { maxDepth: 20, timeBudgetMs: 400, slack: 0 },
};

/** Deterministic per call, so a given seed replays the same game. */
function pick<T>(items: readonly T[], random: number): T {
  return items[Math.min(items.length - 1, Math.floor(random * items.length))] as T;
}

export interface BotChoice {
  move: Move | null;
  depth: number;
  nodes: number;
  elapsedMs: number;
}

export function chooseMove(
  pos: Position,
  difficulty: Difficulty,
  random: number = Math.random(),
): BotChoice {
  const config = LEVELS[difficulty];
  const result = search(pos, config);
  if (result.best === null) {
    return { move: null, depth: 0, nodes: result.nodes, elapsedMs: result.elapsedMs };
  }

  const bestScore = result.rootMoves[0]?.score ?? 0;
  const acceptable: ScoredMove[] =
    config.slack === 0
      ? result.rootMoves.slice(0, 1)
      : result.rootMoves.filter((m) => bestScore - m.score <= config.slack);

  const chosen = acceptable.length > 1 ? pick(acceptable, random).move : result.best;

  return {
    move: chosen,
    depth: result.depth,
    nodes: result.nodes,
    elapsedMs: result.elapsedMs,
  };
}

/**
 * The floor before the bot plays, measured from the moment the human's move is dispatched.
 *
 * The search answers in single-digit milliseconds, and a reply that fast does not read as
 * a move at all: it reads as the board glitching. The wait is the interaction. See the
 * difficulty icon, which animates as an equaliser for exactly this window.
 *
 * A move takes `--dur-move` (190ms) to travel, so the gap a player actually perceives,
 * from their piece landing to the bot's starting, is this figure minus that. At 1200ms
 * that is a beat over a second, which is long enough to read as a considered reply rather
 * than an interruption of the move that just finished.
 */
export const THINK_FLOOR_MS = 1200;
