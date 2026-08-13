/**
 * Piece identity.
 *
 * The engine works in squares. The view works in pieces, because a piece that keeps its
 * React key keeps its DOM node, and a kept node is what lets one CSS transition animate a
 * move. Diffing two boards cannot produce that: it would tell us a knight left c3 and a
 * knight arrived on e4, not that it was the same knight.
 *
 * So the identity list is threaded forward through every move instead.
 */

import { at, colorOf, fileOf, off, rankOf, typeOf } from "../chess/board.ts";
import type { Color, Move, PieceType, Position, Square } from "../chess/types.ts";
import { EMPTY, FLAG_CASTLE, FLAG_EN_PASSANT, KING, WHITE } from "../chess/types.ts";

export interface PieceView {
  /** Stable for the piece's whole life, including across a promotion. */
  id: string;
  type: PieceType;
  color: Color;
  square: Square;
  captured: boolean;
}

export function initialPieces(pos: Position): PieceView[] {
  const pieces: PieceView[] = [];
  let counter = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (off(sq)) continue;
    const piece = at(pos.board, sq);
    if (piece === EMPTY) continue;
    counter += 1;
    pieces.push({
      id: `p${counter}`,
      type: typeOf(piece),
      color: colorOf(piece),
      square: sq,
      captured: false,
    });
  }
  return pieces;
}

/** Where the rook stands and lands during a castle, from the king's travel. */
function rookTravel(move: Move): { from: Square; to: Square } {
  return move.to > move.from
    ? { from: move.from + 3, to: move.from + 1 }
    : { from: move.from - 4, to: move.from - 1 };
}

/**
 * Returns the next identity list. Captured pieces stay in the list with `captured: true`
 * so their exit animation can run, and are dropped on the next move.
 */
export function applyMoveToPieces(
  pieces: readonly PieceView[],
  move: Move,
  mover: Color,
): PieceView[] {
  const live = pieces.filter((p) => !p.captured);

  // En passant takes a pawn that is not standing on the destination square.
  const capturedSquare =
    (move.flags & FLAG_EN_PASSANT) !== 0 ? move.to + (mover === WHITE ? -16 : 16) : move.to;

  const rook = (move.flags & FLAG_CASTLE) !== 0 ? rookTravel(move) : null;

  return live.map((piece) => {
    if (piece.square === move.from) {
      return {
        ...piece,
        square: move.to,
        // A promotion keeps the id, so the glyph swaps on a piece that never left.
        type: move.promo === 0 ? piece.type : move.promo,
      };
    }
    if (rook !== null && piece.square === rook.from && typeOf(piece.type) !== KING) {
      return { ...piece, square: rook.to };
    }
    if (piece.square === capturedSquare && piece.color !== mover) {
      return { ...piece, captured: true };
    }
    return piece;
  });
}

/*
 * Board coordinates.
 *
 * `flipped` means the player is Black, so their pieces sit at the bottom and the files run
 * h to a. Orientation lives here and nowhere else: every component asks these three
 * functions rather than doing the arithmetic, so the board, the pieces and the promotion
 * stack cannot disagree about which way round it is.
 *
 * The light and dark squares work out on their own. a1 is dark either way, because
 * flipping inverts both the row and the column and their sum keeps its parity.
 */

/** Board column for a square. Column 0 is the a file, or the h file when flipped. */
export function columnOf(square: Square, flipped = false): number {
  return flipped ? 7 - fileOf(square) : fileOf(square);
}

/** Board row for a square. Row 0 is the eighth rank, or the first when flipped. */
export function rowOf(square: Square, flipped = false): number {
  return flipped ? rankOf(square) : 7 - rankOf(square);
}

/** The square at a grid cell, which is the inverse of the two above. */
export function squareAt(row: number, column: number, flipped = false): Square {
  return flipped ? row * 16 + (7 - column) : (7 - row) * 16 + column;
}
