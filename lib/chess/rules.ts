/**
 * Legality, check, and every way a game ends.
 */

import { at, kingSquare, off, typeOf } from "./board.ts";
import { makeMove, unmakeMove } from "./make.ts";
import { generateMoves, isAttacked } from "./moves.ts";
import type { Color, GameStatus, Move, Position, Square } from "./types.ts";
import { BISHOP, EMPTY, FLAG_EN_PASSANT, KNIGHT, PAWN, QUEEN, ROOK } from "./types.ts";

/**
 * En passant is the reason this is a function rather than a `captured !== EMPTY` check:
 * the taken pawn is not standing on the destination square, so the move carries no
 * captured piece even though something comes off the board.
 */
export function isCapture(move: Move): boolean {
  return move.captured !== EMPTY || (move.flags & FLAG_EN_PASSANT) !== 0;
}

export function isInCheck(pos: Position, color: Color): boolean {
  const king = kingSquare(pos, color);
  return king >= 0 && isAttacked(pos, king, -color as Color);
}

/**
 * Pseudo-legal moves, filtered by making each one and testing whether the mover left its
 * own king attacked.
 */
export function legalMoves(pos: Position): Move[] {
  const us = pos.side;
  const legal: Move[] = [];
  for (const move of generateMoves(pos)) {
    makeMove(pos, move);
    if (!isAttacked(pos, kingSquare(pos, us), -us as Color)) legal.push(move);
    unmakeMove(pos, move);
  }
  return legal;
}

export function legalMovesFrom(pos: Position, from: Square): Move[] {
  return legalMoves(pos).filter((m) => m.from === from);
}

/** How many times the current position has occurred, including now. */
export function repetitionCount(pos: Position): number {
  let count = 0;
  for (const hash of pos.seen) if (hash === pos.hash) count += 1;
  return count;
}

/**
 * Material that can never force mate.
 *
 * The set is the conventional one: bare kings, a lone minor piece, and opposite bishops
 * sitting on the same square colour. Two knights are excluded, because mate is reachable
 * there even though it cannot be forced.
 */
export function hasInsufficientMaterial(pos: Position): boolean {
  const bishopSquareColors: number[] = [];
  let knights = 0;
  let bishops = 0;

  for (let sq = 0; sq < 128; sq++) {
    if (off(sq)) continue;
    const piece = at(pos.board, sq);
    if (piece === EMPTY) continue;
    const type = typeOf(piece);
    if (type === PAWN || type === ROOK || type === QUEEN) return false;
    if (type === KNIGHT) knights += 1;
    if (type === BISHOP) {
      bishops += 1;
      // On 0x88, rank plus file parity gives the square colour.
      bishopSquareColors.push(((sq >> 4) + (sq & 7)) & 1);
    }
  }

  if (knights === 0 && bishops === 0) return true;
  if (knights + bishops === 1) return true;
  if (knights === 0 && bishops > 0) {
    return bishopSquareColors.every((c) => c === bishopSquareColors[0]);
  }
  return false;
}

export function gameStatus(pos: Position): GameStatus {
  const check = isInCheck(pos, pos.side);
  if (legalMoves(pos).length === 0) return check ? "checkmate" : "stalemate";
  if (hasInsufficientMaterial(pos)) return "draw-insufficient";
  if (pos.halfmove >= 100) return "draw-fifty-move";
  if (repetitionCount(pos) >= 3) return "draw-repetition";
  return check ? "check" : "playing";
}

export function isGameOver(status: GameStatus): boolean {
  return status !== "playing" && status !== "check";
}

const PIECE_VALUE: Record<number, number> = {
  [PAWN]: 1,
  [KNIGHT]: 3,
  [BISHOP]: 3,
  [ROOK]: 5,
  [QUEEN]: 9,
};

/** Material balance in pawns, positive when White leads. Kings are not counted. */
export function materialBalance(pos: Position): number {
  let total = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (off(sq)) continue;
    const piece = at(pos.board, sq);
    if (piece === EMPTY) continue;
    const value = PIECE_VALUE[typeOf(piece)];
    if (value === undefined) continue;
    total += piece > 0 ? value : -value;
  }
  return total;
}
