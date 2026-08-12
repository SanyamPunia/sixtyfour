/**
 * The 0x88 board, and reading and writing FEN.
 *
 * A square is `rank * 16 + file`, so rank 0 is White's back rank and file 0 is the a file.
 * The upper nibble holds the rank and the lower nibble the file, which makes the off-board
 * test a single mask. Squares 8..15 of each rank are the unused half.
 */

import type { Color, Piece, PieceType, Position, Square } from "./types.ts";
import {
  BISHOP,
  BLACK,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  EMPTY,
  KING,
  KNIGHT,
  NO_SQUARE,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
} from "./types.ts";
import { hashPosition } from "./zobrist.ts";

export const KNIGHT_DELTAS = [33, 31, 18, 14, -33, -31, -18, -14] as const;
export const BISHOP_DELTAS = [17, 15, -17, -15] as const;
export const ROOK_DELTAS = [16, 1, -16, -1] as const;
export const KING_DELTAS = [17, 16, 15, 1, -17, -16, -15, -1] as const;

/**
 * Castling rights that survive a square being touched, whether by moving from it or by
 * being captured on it. Indexing this beats four conditionals in `make`.
 */
export const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[0] = 15 & ~CASTLE_WQ; // a1
CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ); // e1
CASTLE_MASK[7] = 15 & ~CASTLE_WK; // h1
CASTLE_MASK[112] = 15 & ~CASTLE_BQ; // a8
CASTLE_MASK[116] = 15 & ~(CASTLE_BK | CASTLE_BQ); // e8
CASTLE_MASK[119] = 15 & ~CASTLE_BK; // h8

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** True when the index falls in the unused half of the 0x88 layout. */
export function off(sq: Square): boolean {
  return (sq & 0x88) !== 0;
}

/**
 * Every read of the board goes through here.
 *
 * `noUncheckedIndexedAccess` widens a typed-array read to `number | undefined`, which is
 * correct in general and wrong for this board: it is a fixed 128 entries and every index
 * reaching it has already passed `off()`. One documented assertion here is better than one
 * at each of the many call sites in the generator.
 */
export function at(board: Int8Array, sq: Square): Piece {
  return board[sq] as Piece;
}

export function rankOf(sq: Square): number {
  return sq >> 4;
}

export function fileOf(sq: Square): number {
  return sq & 7;
}

export function colorOf(piece: Piece): Color {
  return piece > 0 ? WHITE : BLACK;
}

export function typeOf(piece: Piece): PieceType {
  return Math.abs(piece) as PieceType;
}

export function squareFrom(file: number, rank: number): Square {
  return rank * 16 + file;
}

const FILE_NAMES = "abcdefgh";

export function algebraic(sq: Square): string {
  return `${FILE_NAMES[fileOf(sq)]}${rankOf(sq) + 1}`;
}

export function parseSquare(name: string): Square {
  const file = FILE_NAMES.indexOf(name[0] ?? "");
  const rank = Number(name[1]) - 1;
  if (file < 0 || Number.isNaN(rank) || rank < 0 || rank > 7) return NO_SQUARE;
  return squareFrom(file, rank);
}

const FEN_TO_TYPE: Record<string, PieceType> = {
  p: PAWN,
  n: KNIGHT,
  b: BISHOP,
  r: ROOK,
  q: QUEEN,
  k: KING,
};
const TYPE_TO_FEN = ["", "p", "n", "b", "r", "q", "k"];

export function parseFen(fen: string): Position {
  const parts = fen.trim().split(/\s+/);
  const placement = parts[0] ?? "";
  const side = parts[1] === "b" ? BLACK : WHITE;
  const castle = parts[2] ?? "-";
  const ep = parts[3] ?? "-";
  const halfmove = Number(parts[4] ?? 0);
  const fullmove = Number(parts[5] ?? 1);

  const board = new Int8Array(128);
  let sq = 112; // a8, because FEN starts at the eighth rank
  for (const ch of placement) {
    if (ch === "/") {
      sq -= 24; // back to the a file, one rank down
      continue;
    }
    if (ch >= "1" && ch <= "8") {
      sq += Number(ch);
      continue;
    }
    const type = FEN_TO_TYPE[ch.toLowerCase()];
    if (type === undefined) throw new Error(`bad FEN piece: ${ch}`);
    board[sq] = ch === ch.toUpperCase() ? type : -type;
    sq += 1;
  }

  let rights = 0;
  if (castle.includes("K")) rights |= CASTLE_WK;
  if (castle.includes("Q")) rights |= CASTLE_WQ;
  if (castle.includes("k")) rights |= CASTLE_BK;
  if (castle.includes("q")) rights |= CASTLE_BQ;

  let whiteKing = NO_SQUARE;
  let blackKing = NO_SQUARE;
  for (let i = 0; i < 128; i++) {
    if (off(i)) continue;
    const piece = at(board, i);
    if (piece === KING) whiteKing = i;
    else if (piece === -KING) blackKing = i;
  }

  const pos: Position = {
    board,
    side,
    rights,
    ep: ep === "-" ? NO_SQUARE : parseSquare(ep),
    halfmove: Number.isNaN(halfmove) ? 0 : halfmove,
    fullmove: Number.isNaN(fullmove) ? 1 : fullmove,
    whiteKing,
    blackKing,
    hash: 0,
    seen: [],
    undo: [],
  };
  pos.hash = hashPosition(pos);
  pos.seen.push(pos.hash);
  return pos;
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = "";
    let gap = 0;
    for (let file = 0; file < 8; file++) {
      const piece = at(pos.board, squareFrom(file, rank));
      if (piece === EMPTY) {
        gap += 1;
        continue;
      }
      if (gap > 0) {
        row += String(gap);
        gap = 0;
      }
      const letter = TYPE_TO_FEN[typeOf(piece)] as string;
      row += piece > 0 ? letter.toUpperCase() : letter;
    }
    if (gap > 0) row += String(gap);
    rows.push(row);
  }
  let castle = "";
  if (pos.rights & CASTLE_WK) castle += "K";
  if (pos.rights & CASTLE_WQ) castle += "Q";
  if (pos.rights & CASTLE_BK) castle += "k";
  if (pos.rights & CASTLE_BQ) castle += "q";
  return [
    rows.join("/"),
    pos.side === WHITE ? "w" : "b",
    castle === "" ? "-" : castle,
    pos.ep === NO_SQUARE ? "-" : algebraic(pos.ep),
    String(pos.halfmove),
    String(pos.fullmove),
  ].join(" ");
}

export function startPosition(): Position {
  return parseFen(START_FEN);
}

export function kingSquare(pos: Position, color: Color): Square {
  return color === WHITE ? pos.whiteKing : pos.blackKing;
}

/**
 * A deep enough copy for the view layer.
 *
 * The search mutates one position with make and unmake, which is what makes it fast. React
 * needs a new reference per move instead, so the reducer clones before it makes. The undo
 * stack is intentionally not carried over: a cloned position is a fresh starting point.
 */
export function clonePosition(pos: Position): Position {
  return {
    board: Int8Array.from(pos.board),
    side: pos.side,
    rights: pos.rights,
    ep: pos.ep,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
    whiteKing: pos.whiteKing,
    blackKing: pos.blackKing,
    hash: pos.hash,
    seen: [...pos.seen],
    undo: [],
  };
}
