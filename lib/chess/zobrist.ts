/**
 * Zobrist hashing, used only for threefold repetition.
 *
 * The keys are 32 bit. A full engine would want 64, but this hash never leaves the
 * current game: a long game reaches a few hundred positions, and the birthday bound for a
 * 50% collision chance over 2^32 is about 77,000. The keys are generated from a fixed seed
 * so a hash is stable across reloads and across the worker boundary.
 */

import type { Color, Piece, Position, Square } from "./types.ts";
import { BLACK } from "./types.ts";

/** mulberry32, chosen because it is four lines and deterministic. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const random = rng(0x5f3a71c9);

/** Indexed by `pieceIndex(piece) * 128 + square`. 12 piece codes, 128 squares. */
const PIECE_KEYS = new Uint32Array(12 * 128);
for (let i = 0; i < PIECE_KEYS.length; i++) PIECE_KEYS[i] = random();

const CASTLE_KEYS = new Uint32Array(16);
for (let i = 0; i < CASTLE_KEYS.length; i++) CASTLE_KEYS[i] = random();

/** Keyed by file, because only the file of an en passant square can matter. */
const EP_KEYS = new Uint32Array(8);
for (let i = 0; i < EP_KEYS.length; i++) EP_KEYS[i] = random();

const SIDE_KEY = random();

/** Maps a signed piece code to 0..11. */
function pieceIndex(piece: Piece): number {
  return piece > 0 ? piece - 1 : 5 - piece;
}

export function pieceKey(piece: Piece, square: Square): number {
  return PIECE_KEYS[pieceIndex(piece) * 128 + square] as number;
}

export function castleKey(rights: number): number {
  return CASTLE_KEYS[rights & 15] as number;
}

export function epKey(square: Square): number {
  return EP_KEYS[square & 7] as number;
}

export const sideKey = SIDE_KEY;

/** Full recompute. Used once per position built from a FEN, never inside the search. */
export function hashPosition(pos: Position): number {
  let h = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue;
    const piece = pos.board[sq] as Piece;
    if (piece !== 0) h ^= pieceKey(piece, sq);
  }
  h ^= castleKey(pos.rights);
  if (pos.ep >= 0) h ^= epKey(pos.ep);
  if (pos.side === BLACK) h ^= SIDE_KEY;
  return h >>> 0;
}

export function sideToMoveKey(side: Color): number {
  return side === BLACK ? SIDE_KEY : 0;
}
