/**
 * Alpha-beta search with iterative deepening.
 *
 * The move generator measures around 8 to 10 million nodes per second, so the search is
 * not the constraint here. It is bounded by a time budget rather than a node count, which
 * keeps the bot's response time steady as positions get more or less complicated.
 */

import { kingSquare, typeOf } from "../chess/board.ts";
import { makeMove, unmakeMove } from "../chess/make.ts";
import { generateMoves, isAttacked } from "../chess/moves.ts";
import type { Color, Move, Position } from "../chess/types.ts";
import { EMPTY, FLAG_EN_PASSANT } from "../chess/types.ts";
import { evaluate, PIECE_VALUE } from "./evaluate.ts";

const MATE = 100_000;
const MAX_PLY = 64;

export interface SearchConfig {
  maxDepth: number;
  /** Wall-clock ceiling. Iterative deepening stops at the first depth that overruns it. */
  timeBudgetMs: number;
}

export interface ScoredMove {
  move: Move;
  score: number;
}

export interface SearchResult {
  best: Move | null;
  /** Every root move with its score, so a difficulty level can sample instead of taking the top. */
  rootMoves: ScoredMove[];
  depth: number;
  nodes: number;
  elapsedMs: number;
}

/**
 * Most Valuable Victim, Least Valuable Attacker.
 *
 * Trying a pawn takes queen before queen takes pawn is what makes alpha-beta prune well.
 * Ordering is worth far more than any evaluation term at these depths.
 */
function captureScore(move: Move): number {
  if (move.captured === EMPTY && (move.flags & FLAG_EN_PASSANT) === 0) return 0;
  const victim = move.captured === EMPTY ? PIECE_VALUE[1] : PIECE_VALUE[typeOf(move.captured)];
  const attacker = PIECE_VALUE[typeOf(move.piece)];
  return 10_000 + victim * 10 - attacker;
}

function orderMoves(moves: Move[], preferred: Move | null, killers: (Move | null)[]): void {
  const rank = (move: Move): number => {
    if (
      preferred !== null &&
      move.from === preferred.from &&
      move.to === preferred.to &&
      move.promo === preferred.promo
    ) {
      return 1_000_000;
    }
    const capture = captureScore(move);
    if (capture > 0) return capture;
    for (const [i, killer] of killers.entries()) {
      if (killer !== null && killer.from === move.from && killer.to === move.to) {
        return 9_000 - i;
      }
    }
    return move.promo === 0 ? 0 : 8_000;
  };
  moves.sort((a, b) => rank(b) - rank(a));
}

function inCheck(pos: Position, color: Color): boolean {
  return isAttacked(pos, kingSquare(pos, color), -color as Color);
}

class Searcher {
  nodes = 0;
  private deadline = Number.POSITIVE_INFINITY;
  private aborted = false;
  private killers: Array<Array<Move | null>> = Array.from({ length: MAX_PLY }, () => [
    null,
    null,
  ]);

  // Written out rather than a parameter property: node --test strips types only, and
  // parameter properties need a real transform.
  private readonly pos: Position;

  constructor(pos: Position) {
    this.pos = pos;
  }

  private outOfTime(): boolean {
    // Checking the clock is not free, so only every few thousand nodes.
    if ((this.nodes & 2047) === 0 && performance.now() > this.deadline) this.aborted = true;
    return this.aborted;
  }

  /**
   * Search only captures until the position is quiet.
   *
   * Without this the bot happily plays a move whose whole point is undone by the recapture
   * one ply past the horizon.
   */
  private quiesce(alpha: number, beta: number, ply: number): number {
    this.nodes += 1;
    const standPat = evaluate(this.pos);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (ply >= MAX_PLY - 1) return alpha;

    const us = this.pos.side;
    const moves = generateMoves(this.pos).filter(
      (m) => m.captured !== EMPTY || (m.flags & FLAG_EN_PASSANT) !== 0 || m.promo !== 0,
    );
    orderMoves(moves, null, [null, null]);

    for (const move of moves) {
      makeMove(this.pos, move);
      if (inCheck(this.pos, us)) {
        unmakeMove(this.pos, move);
        continue;
      }
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      unmakeMove(this.pos, move);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number): number {
    if (this.outOfTime()) return 0;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);

    this.nodes += 1;
    const us = this.pos.side;
    const checked = inCheck(this.pos, us);
    // Being in check means the position is unstable, so spend another ply rather than
    // evaluating a forced sequence halfway through it.
    const searchDepth = checked ? depth + 1 : depth;

    const moves = generateMoves(this.pos);
    orderMoves(moves, null, this.killers[ply] ?? [null, null]);

    let legal = 0;
    let best = -MATE;

    for (const move of moves) {
      makeMove(this.pos, move);
      if (inCheck(this.pos, us)) {
        unmakeMove(this.pos, move);
        continue;
      }
      legal += 1;
      const score = -this.negamax(searchDepth - 1, -beta, -alpha, ply + 1);
      unmakeMove(this.pos, move);

      if (this.aborted) return 0;
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (move.captured === EMPTY) {
          const slot = this.killers[ply];
          if (slot !== undefined && slot[0] !== move) {
            slot[1] = slot[0] ?? null;
            slot[0] = move;
          }
        }
        return beta;
      }
    }

    if (legal === 0) {
      // Mate scores count plies, so the bot prefers a mate in one over a mate in three.
      return checked ? -MATE + ply : 0;
    }
    return best;
  }

  run(config: SearchConfig): SearchResult {
    const started = performance.now();
    this.deadline = started + config.timeBudgetMs;

    const us = this.pos.side;
    const rootMoves = generateMoves(this.pos).filter((move) => {
      makeMove(this.pos, move);
      const ok = !inCheck(this.pos, us);
      unmakeMove(this.pos, move);
      return ok;
    });

    if (rootMoves.length === 0) {
      return { best: null, rootMoves: [], depth: 0, nodes: 0, elapsedMs: 0 };
    }

    let scored: ScoredMove[] = rootMoves.map((move) => ({ move, score: 0 }));
    let completedDepth = 0;
    let preferred: Move | null = null;

    for (let depth = 1; depth <= config.maxDepth; depth++) {
      const round: ScoredMove[] = [];
      let alpha = -MATE * 2;
      const ordered = [...rootMoves];
      orderMoves(ordered, preferred, [null, null]);

      for (const move of ordered) {
        makeMove(this.pos, move);
        const score = -this.negamax(depth - 1, -MATE * 2, -alpha, 1);
        unmakeMove(this.pos, move);
        if (this.aborted) break;
        round.push({ move, score });
        if (score > alpha) alpha = score;
      }

      if (this.aborted) break;

      round.sort((a, b) => b.score - a.score);
      scored = round;
      completedDepth = depth;
      preferred = round[0]?.move ?? null;

      // A mate is found, so deeper searching cannot improve on it.
      if (Math.abs(round[0]?.score ?? 0) > MATE - MAX_PLY) break;
      if (performance.now() > this.deadline) break;
    }

    return {
      best: scored[0]?.move ?? (rootMoves[0] as Move),
      rootMoves: scored,
      depth: completedDepth,
      nodes: this.nodes,
      elapsedMs: performance.now() - started,
    };
  }
}

export function search(pos: Position, config: SearchConfig): SearchResult {
  return new Searcher(pos).run(config);
}
