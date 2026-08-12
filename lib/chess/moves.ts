/**
 * Pseudo-legal move generation.
 *
 * "Pseudo-legal" means a move here may still leave its own king in check. `rules.ts`
 * filters those out by making the move and testing the king. A pin-aware generator would
 * be faster and is much easier to get subtly wrong, and the measured speed says we do not
 * need it.
 */

import {
  at,
  BISHOP_DELTAS,
  KING_DELTAS,
  KNIGHT_DELTAS,
  off,
  ROOK_DELTAS,
  rankOf,
  typeOf,
} from "./board.ts";
import type { Color, Move, Piece, Position, PromotionType, Square } from "./types.ts";
import {
  BISHOP,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  EMPTY,
  FLAG_CASTLE,
  FLAG_DOUBLE_PUSH,
  FLAG_EN_PASSANT,
  KING,
  KNIGHT,
  NO_SQUARE,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
} from "./types.ts";

const PROMOTIONS: readonly PromotionType[] = [QUEEN, ROOK, BISHOP, KNIGHT];

/** Squares a pawn of `by` attacks arrive from, relative to the target. */
const PAWN_ATTACK_FROM = {
  white: [-15, -17],
  black: [15, 17],
} as const;

/** Where a pawn of each colour captures to, relative to its own square. */
const PAWN_CAPTURE_TO = {
  white: [15, 17],
  black: [-15, -17],
} as const;

/**
 * Is `sq` attacked by any piece of colour `by`?
 *
 * Used for legality, for check detection, and for the three squares a castling king may
 * not cross. It walks outward from the target rather than scanning every enemy piece,
 * which is the cheaper direction.
 */
export function isAttacked(pos: Position, sq: Square, by: Color): boolean {
  const board = pos.board;

  const pawnFrom = by === WHITE ? PAWN_ATTACK_FROM.white : PAWN_ATTACK_FROM.black;
  for (const delta of pawnFrom) {
    const from = sq + delta;
    if (!off(from) && at(board, from) === by * PAWN) return true;
  }

  for (const delta of KNIGHT_DELTAS) {
    const from = sq + delta;
    if (!off(from) && at(board, from) === by * KNIGHT) return true;
  }

  for (const delta of KING_DELTAS) {
    const from = sq + delta;
    if (!off(from) && at(board, from) === by * KING) return true;
  }

  for (const delta of BISHOP_DELTAS) {
    for (let from = sq + delta; !off(from); from += delta) {
      const piece = at(board, from);
      if (piece === EMPTY) continue;
      if (piece === by * BISHOP || piece === by * QUEEN) return true;
      break;
    }
  }

  for (const delta of ROOK_DELTAS) {
    for (let from = sq + delta; !off(from); from += delta) {
      const piece = at(board, from);
      if (piece === EMPTY) continue;
      if (piece === by * ROOK || piece === by * QUEEN) return true;
      break;
    }
  }

  return false;
}

function push(
  moves: Move[],
  board: Int8Array,
  from: Square,
  to: Square,
  promo: PromotionType | 0,
  flags: number,
): void {
  moves.push({
    from,
    to,
    piece: at(board, from),
    captured: at(board, to),
    promo,
    flags,
  });
}

function generatePawn(pos: Position, from: Square, us: Color, moves: Move[]): void {
  const board = pos.board;
  const forward = us === WHITE ? 16 : -16;
  const startRank = us === WHITE ? 1 : 6;
  const promoRank = us === WHITE ? 7 : 0;

  const one = from + forward;
  if (!off(one) && at(board, one) === EMPTY) {
    if (rankOf(one) === promoRank) {
      for (const promo of PROMOTIONS) push(moves, board, from, one, promo, 0);
    } else {
      push(moves, board, from, one, 0, 0);
      const two = one + forward;
      if (rankOf(from) === startRank && at(board, two) === EMPTY) {
        push(moves, board, from, two, 0, FLAG_DOUBLE_PUSH);
      }
    }
  }

  const captures = us === WHITE ? PAWN_CAPTURE_TO.white : PAWN_CAPTURE_TO.black;
  for (const delta of captures) {
    const to = from + delta;
    if (off(to)) continue;
    const target = at(board, to);
    if (target !== EMPTY && Math.sign(target) === -us) {
      if (rankOf(to) === promoRank) {
        for (const promo of PROMOTIONS) push(moves, board, from, to, promo, 0);
      } else {
        push(moves, board, from, to, 0, 0);
      }
    } else if (to === pos.ep && target === EMPTY) {
      push(moves, board, from, to, 0, FLAG_EN_PASSANT);
    }
  }
}

function generateCastles(pos: Position, us: Color, moves: Move[]): void {
  const board = pos.board;
  const king = us === WHITE ? pos.whiteKing : pos.blackKing;
  if (king === NO_SQUARE) return;

  const kingSideRight = us === WHITE ? CASTLE_WK : CASTLE_BK;
  const queenSideRight = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
  const them = -us as Color;

  // The king may not start in check, pass through an attacked square, or land on one.
  if (
    pos.rights & kingSideRight &&
    at(board, king + 1) === EMPTY &&
    at(board, king + 2) === EMPTY &&
    !isAttacked(pos, king, them) &&
    !isAttacked(pos, king + 1, them) &&
    !isAttacked(pos, king + 2, them)
  ) {
    push(moves, board, king, king + 2, 0, FLAG_CASTLE);
  }

  // Queen side also needs b1 or b8 empty, which the king never crosses.
  if (
    pos.rights & queenSideRight &&
    at(board, king - 1) === EMPTY &&
    at(board, king - 2) === EMPTY &&
    at(board, king - 3) === EMPTY &&
    !isAttacked(pos, king, them) &&
    !isAttacked(pos, king - 1, them) &&
    !isAttacked(pos, king - 2, them)
  ) {
    push(moves, board, king, king - 2, 0, FLAG_CASTLE);
  }
}

export function generateMoves(pos: Position): Move[] {
  const board = pos.board;
  const us = pos.side;
  const moves: Move[] = [];

  for (let from = 0; from < 128; from++) {
    if (off(from)) continue;
    const piece: Piece = at(board, from);
    if (piece === EMPTY || Math.sign(piece) !== us) continue;

    const type = typeOf(piece);
    if (type === PAWN) {
      generatePawn(pos, from, us, moves);
      continue;
    }

    const sliding = type === BISHOP || type === ROOK || type === QUEEN;
    const deltas =
      type === KNIGHT
        ? KNIGHT_DELTAS
        : type === BISHOP
          ? BISHOP_DELTAS
          : type === ROOK
            ? ROOK_DELTAS
            : KING_DELTAS;

    for (const delta of deltas) {
      let to = from + delta;
      while (!off(to)) {
        const target = at(board, to);
        if (target === EMPTY) {
          push(moves, board, from, to, 0, 0);
        } else {
          if (Math.sign(target) === -us) push(moves, board, from, to, 0, 0);
          break;
        }
        if (!sliding) break;
        to += delta;
      }
    }
  }

  generateCastles(pos, us, moves);
  return moves;
}

/** Captures and promotions only. The quiescence search uses this. */
export function generateCaptures(pos: Position): Move[] {
  return generateMoves(pos).filter(
    (m) => m.captured !== EMPTY || m.promo !== 0 || (m.flags & FLAG_EN_PASSANT) !== 0,
  );
}
