/**
 * Applying and undoing a move in place.
 *
 * The search shares one `Position` and walks it with make and unmake, so nothing is
 * copied per node. Every field that a move can change is recorded on the undo stack
 * before it is touched.
 */

import { at, CASTLE_MASK, typeOf } from "./board.ts";
import type { Color, Move, Piece, Position, Square, Undo } from "./types.ts";
import {
  EMPTY,
  FLAG_CASTLE,
  FLAG_DOUBLE_PUSH,
  FLAG_EN_PASSANT,
  KING,
  NO_SQUARE,
  PAWN,
  WHITE,
} from "./types.ts";
import { castleKey, epKey, pieceKey, sideKey } from "./zobrist.ts";

/** Where the rook sits and lands for a castling move, derived from the king's travel. */
function rookSquares(from: Square, to: Square): { rookFrom: Square; rookTo: Square } {
  return to > from
    ? { rookFrom: from + 3, rookTo: from + 1 }
    : { rookFrom: from - 4, rookTo: from - 1 };
}

export function makeMove(pos: Position, move: Move): void {
  const board = pos.board;
  const us = pos.side;

  const undo: Undo = {
    rights: pos.rights,
    ep: pos.ep,
    halfmove: pos.halfmove,
    hash: pos.hash,
    captured: move.captured,
    epCaptureSquare: NO_SQUARE,
  };

  let hash = pos.hash;
  hash ^= castleKey(pos.rights);
  if (pos.ep !== NO_SQUARE) hash ^= epKey(pos.ep);

  const moving: Piece = move.piece;
  const landing: Piece = move.promo ? ((us * move.promo) as Piece) : moving;

  hash ^= pieceKey(moving, move.from);
  board[move.from] = EMPTY;

  if (move.captured !== EMPTY) hash ^= pieceKey(move.captured, move.to);
  board[move.to] = landing;
  hash ^= pieceKey(landing, move.to);

  if (move.flags & FLAG_EN_PASSANT) {
    // The captured pawn is beside the destination, never on it.
    const capture = move.to + (us === WHITE ? -16 : 16);
    const pawn = at(board, capture);
    undo.epCaptureSquare = capture;
    undo.captured = pawn;
    hash ^= pieceKey(pawn, capture);
    board[capture] = EMPTY;
  }

  if (move.flags & FLAG_CASTLE) {
    const { rookFrom, rookTo } = rookSquares(move.from, move.to);
    const rook = at(board, rookFrom);
    board[rookFrom] = EMPTY;
    board[rookTo] = rook;
    hash ^= pieceKey(rook, rookFrom) ^ pieceKey(rook, rookTo);
  }

  if (typeOf(moving) === KING) {
    if (us === WHITE) pos.whiteKing = move.to;
    else pos.blackKing = move.to;
  }

  pos.rights &= (CASTLE_MASK[move.from] as number) & (CASTLE_MASK[move.to] as number);
  hash ^= castleKey(pos.rights);

  pos.ep = move.flags & FLAG_DOUBLE_PUSH ? move.from + (us === WHITE ? 16 : -16) : NO_SQUARE;
  if (pos.ep !== NO_SQUARE) hash ^= epKey(pos.ep);

  // The fifty move counter resets on a pawn move and on any capture.
  pos.halfmove =
    typeOf(moving) === PAWN || move.captured !== EMPTY || undo.epCaptureSquare !== NO_SQUARE
      ? 0
      : pos.halfmove + 1;
  if (us !== WHITE) pos.fullmove += 1;

  hash ^= sideKey;
  pos.hash = hash >>> 0;
  pos.side = -us as Color;
  pos.undo.push(undo);
  pos.seen.push(pos.hash);
}

export function unmakeMove(pos: Position, move: Move): void {
  const board = pos.board;
  const undo = pos.undo.pop();
  if (undo === undefined) throw new Error("unmakeMove with an empty undo stack");
  pos.seen.pop();

  pos.side = -pos.side as Color;
  const us = pos.side;
  if (us !== WHITE) pos.fullmove -= 1;

  board[move.from] = move.piece;
  board[move.to] = EMPTY;

  if (undo.epCaptureSquare !== NO_SQUARE) {
    board[undo.epCaptureSquare] = undo.captured;
  } else if (move.captured !== EMPTY) {
    board[move.to] = move.captured;
  }

  if (move.flags & FLAG_CASTLE) {
    const { rookFrom, rookTo } = rookSquares(move.from, move.to);
    board[rookFrom] = at(board, rookTo);
    board[rookTo] = EMPTY;
  }

  if (typeOf(move.piece) === KING) {
    if (us === WHITE) pos.whiteKing = move.from;
    else pos.blackKing = move.from;
  }

  pos.rights = undo.rights;
  pos.ep = undo.ep;
  pos.halfmove = undo.halfmove;
  pos.hash = undo.hash;
}
