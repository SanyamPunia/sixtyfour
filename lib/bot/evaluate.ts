/**
 * Position evaluation, in centipawns, from the point of view of the side to move.
 *
 * Material plus one piece-square table per type. That is enough to make a bot that
 * develops, takes the centre, castles, and does not walk its king into the open. Anything
 * more (pawn structure, mobility, king safety terms) buys strength this product does not
 * want: the hard level already searches deeper than a casual player reads.
 */

import { at, fileOf, off, rankOf, typeOf } from "../chess/board.ts";
import type { Color, PieceType, Position } from "../chess/types.ts";
import { BISHOP, EMPTY, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE } from "../chess/types.ts";

export const PIECE_VALUE: Record<PieceType, number> = {
  [PAWN]: 100,
  [KNIGHT]: 320,
  [BISHOP]: 330,
  [ROOK]: 500,
  [QUEEN]: 900,
  [KING]: 20000,
};

/**
 * Tables are written the way a board looks, rank 8 first, so they can be read and edited
 * without mental rotation. `tableIndex` flips that back at load time.
 */
const prettyTable = (rows: readonly number[]): Int16Array => {
  const table = new Int16Array(64);
  for (let i = 0; i < 64; i++) {
    const rank = 7 - Math.floor(i / 8);
    const file = i % 8;
    table[rank * 8 + file] = rows[i] as number;
  }
  return table;
};

const PAWN_PST = prettyTable([
  0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5,
  10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20,
  -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
]);

const KNIGHT_PST = prettyTable([
  -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15,
  10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15,
  15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
]);

const BISHOP_PST = prettyTable([
  -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0,
  -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10,
  10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
]);

const ROOK_PST = prettyTable([
  0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0,
  0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0,
  0, 0, 5, 5, 0, 0, 0,
]);

const QUEEN_PST = prettyTable([
  -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0,
  0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
]);

/** Middlegame king: stay home and behind pawns. */
const KING_PST = prettyTable([
  -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40,
  -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30,
  -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0,
  0, 10, 30, 20,
]);

/** Endgame king: come out and help. Blended in as material comes off. */
const KING_ENDGAME_PST = prettyTable([
  -50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30,
  30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30,
  -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30,
  -30, -50,
]);

const TABLES: Record<PieceType, Int16Array> = {
  [PAWN]: PAWN_PST,
  [KNIGHT]: KNIGHT_PST,
  [BISHOP]: BISHOP_PST,
  [ROOK]: ROOK_PST,
  [QUEEN]: QUEEN_PST,
  [KING]: KING_PST,
};

/** Table index from a 0x88 square, mirrored for Black so one table serves both. */
function tableIndex(square: number, color: Color): number {
  const rank = rankOf(square);
  return (color === WHITE ? rank : 7 - rank) * 8 + fileOf(square);
}

/** Total non-king, non-pawn material, used to fade the king between its two tables. */
function phaseMaterial(pos: Position): number {
  let total = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (off(sq)) continue;
    const piece = at(pos.board, sq);
    if (piece === EMPTY) continue;
    const type = typeOf(piece);
    if (type !== PAWN && type !== KING) total += PIECE_VALUE[type];
  }
  return total;
}

const OPENING_MATERIAL = 2 * (2 * 320 + 2 * 330 + 2 * 500 + 900);

export function evaluate(pos: Position): number {
  let score = 0;
  const phase = Math.min(1, phaseMaterial(pos) / OPENING_MATERIAL);

  for (let sq = 0; sq < 128; sq++) {
    if (off(sq)) continue;
    const piece = at(pos.board, sq);
    if (piece === EMPTY) continue;

    const color: Color = piece > 0 ? 1 : -1;
    const type = typeOf(piece);
    const index = tableIndex(sq, color);

    let positional: number;
    if (type === KING) {
      const middle = KING_PST[index] as number;
      const end = KING_ENDGAME_PST[index] as number;
      positional = middle * phase + end * (1 - phase);
    } else {
      positional = (TABLES[type] as Int16Array)[index] as number;
    }

    score += color * (PIECE_VALUE[type] + positional);
  }

  // Negamax wants the score from the mover's point of view.
  return pos.side === WHITE ? score : -score;
}
