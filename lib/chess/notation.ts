/**
 * Standard algebraic notation.
 *
 * SAN is only ever read aloud by the status region, so this covers the notation a game
 * actually produces and nothing more.
 */

import { algebraic, at, fileOf, parseSquare, rankOf, typeOf } from "./board.ts";
import { makeMove, unmakeMove } from "./make.ts";
import { isInCheck, legalMoves } from "./rules.ts";
import type { Move, PieceType, Position, PromotionType } from "./types.ts";
import {
  BISHOP,
  EMPTY,
  FLAG_CASTLE,
  FLAG_EN_PASSANT,
  KING,
  KNIGHT,
  NO_SQUARE,
  PAWN,
  QUEEN,
  ROOK,
} from "./types.ts";

const TYPE_LETTER = ["", "", "N", "B", "R", "Q", "K"];

/**
 * Two same-type pieces reaching one square must be told apart. The file alone is the usual
 * answer, the rank is the fallback, and both are needed only in rare promotion positions.
 */
function disambiguate(move: Move, legal: readonly Move[]): string {
  const type = typeOf(move.piece);
  if (type === PAWN || type === KING) return "";

  const rivals = legal.filter(
    (m) => m.to === move.to && m.from !== move.from && typeOf(m.piece) === type,
  );
  if (rivals.length === 0) return "";

  const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
  const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
  const name = algebraic(move.from);
  if (!sameFile) return name[0] as string;
  if (!sameRank) return name[1] as string;
  return name;
}

export function toSan(pos: Position, move: Move): string {
  if (move.flags & FLAG_CASTLE) {
    const text = move.to > move.from ? "O-O" : "O-O-O";
    return text + suffix(pos, move);
  }

  const type = typeOf(move.piece);
  const isCapture = move.captured !== EMPTY || (move.flags & FLAG_EN_PASSANT) !== 0;
  let text = "";

  if (type === PAWN) {
    if (isCapture) text += algebraic(move.from)[0];
  } else {
    text += TYPE_LETTER[type];
    text += disambiguate(move, legalMoves(pos));
  }

  if (isCapture) text += "x";
  text += algebraic(move.to);
  if (move.promo) text += `=${TYPE_LETTER[move.promo]}`;
  return text + suffix(pos, move);
}

/** `+` for check and `#` for mate, decided by playing the move and looking. */
function suffix(pos: Position, move: Move): string {
  makeMove(pos, move);
  const check = isInCheck(pos, pos.side);
  const trapped = check && legalMoves(pos).length === 0;
  unmakeMove(pos, move);
  return trapped ? "#" : check ? "+" : "";
}

const SPOKEN_TYPE = ["", "pawn", "knight", "bishop", "rook", "queen", "king"];

/**
 * A piece's name in words.
 *
 * Kept here with the rest of the notation because the move log names pieces too, and two
 * lists of six words would eventually disagree about one of them.
 */
export function pieceName(type: PieceType): string {
  return SPOKEN_TYPE[type] as string;
}

/** A square label for assistive technology, for example "d4, opponent knight". */
export function describeSquare(pos: Position, square: number, humanColor: number): string {
  const piece = at(pos.board, square);
  const name = algebraic(square);
  if (piece === EMPTY) return `${name}, empty`;
  const owner = Math.sign(piece) === humanColor ? "your" : "opponent";
  return `${name}, ${owner} ${pieceName(typeOf(piece))}`;
}

const PROMO_LETTER: Record<number, string> = {
  [KNIGHT]: "n",
  [BISHOP]: "b",
  [ROOK]: "r",
  [QUEEN]: "q",
};

const PROMO_TYPE: Record<string, PromotionType> = {
  n: KNIGHT,
  b: BISHOP,
  r: ROOK,
  q: QUEEN,
};

/**
 * A move as four or five characters, for example `e2e4` or `e7e8q`.
 *
 * SAN is written for a person to read and needs the whole position to resolve. This is
 * written for a wire and resolves from the two squares alone, which is what a move sent
 * between two machines wants.
 */
export function toUci(move: Move): string {
  const promo = move.promo === 0 ? "" : (PROMO_LETTER[move.promo] ?? "");
  return algebraic(move.from) + algebraic(move.to) + promo;
}

/**
 * The legal move a string names, or null.
 *
 * Resolution is a lookup against the moves the position actually allows, so this is the
 * validation as well as the parse. Nothing that fails to match here can be played, which
 * is what lets a server accept a move from a client it does not trust.
 */
export function fromUci(pos: Position, uci: string): Move | null {
  if (uci.length !== 4 && uci.length !== 5) return null;
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  if (from === NO_SQUARE || to === NO_SQUARE) return null;

  const promo = uci.length === 5 ? PROMO_TYPE[uci[4] as string] : undefined;
  if (uci.length === 5 && promo === undefined) return null;

  return (
    legalMoves(pos).find(
      (m) =>
        m.from === from &&
        m.to === to &&
        (promo === undefined ? m.promo === 0 : m.promo === promo),
    ) ?? null
  );
}
