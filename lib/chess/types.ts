/**
 * Core chess types.
 *
 * Colour is carried as the sign of a piece code, so `-KNIGHT` is a black knight and
 * `Math.sign(piece)` is its colour. That removes a branch from every read in the move
 * generator, which is the hottest code in the project.
 */

export type Color = 1 | -1;
export const WHITE: Color = 1;
export const BLACK: Color = -1;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export type PieceType = 1 | 2 | 3 | 4 | 5 | 6;
export type PromotionType = 2 | 3 | 4 | 5;

/** A signed piece code: `color * type`. Zero is an empty square. */
export type Piece = number;

/** A 0x88 board index. Values with a bit set in `0x88` are off the board. */
export type Square = number;

export const EMPTY = 0;
export const NO_SQUARE = -1;

/** Castling rights, as a bit mask. */
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

/** Move flags, as a bit mask. */
export const FLAG_DOUBLE_PUSH = 1;
export const FLAG_EN_PASSANT = 2;
export const FLAG_CASTLE = 4;

export interface Move {
  readonly from: Square;
  readonly to: Square;
  /** The piece as it stood on `from`, before any promotion. */
  readonly piece: Piece;
  /** The piece standing on `to`. Zero for a quiet move and for en passant. */
  readonly captured: Piece;
  /** The type promoted to, or zero. */
  readonly promo: PromotionType | 0;
  readonly flags: number;
}

/** What `make` needs to put back, so the search never copies a position. */
export interface Undo {
  rights: number;
  ep: Square;
  halfmove: number;
  hash: number;
  /** The captured piece, which for en passant is not the piece that stood on `to`. */
  captured: Piece;
  /** Where the captured pawn actually stood, or `NO_SQUARE` outside en passant. */
  epCaptureSquare: Square;
}

export interface Position {
  board: Int8Array;
  side: Color;
  rights: number;
  ep: Square;
  halfmove: number;
  fullmove: number;
  whiteKing: Square;
  blackKing: Square;
  /** 32 bits is ample for repetition inside one game. See `zobrist.ts`. */
  hash: number;
  /** Hashes of every position reached, for threefold repetition. */
  seen: number[];
  undo: Undo[];
}

export type GameStatus =
  | "playing"
  | "check"
  | "checkmate"
  | "stalemate"
  | "draw-fifty-move"
  | "draw-repetition"
  | "draw-insufficient";
