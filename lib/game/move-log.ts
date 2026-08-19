/**
 * What happened, move by move, in the terms a person reads.
 *
 * Derived rather than recorded. A `Move` already carries the piece as it stood, the piece
 * standing on the destination, the promotion and the flags, so every field below comes out
 * of the move alone with no position to consult and nothing new to keep in state. That
 * matters in a room, where the move list is rebuilt from the server's word by `fromMoves`:
 * a parallel log held beside `history` would be a second thing to keep in step, and the
 * one that fell behind would be the one a player was reading.
 *
 * No React. The list is a pure function of the history, so it is tested with `node --test`.
 */

import { algebraic, colorOf, typeOf } from "../chess/board.ts";
import { pieceName } from "../chess/notation.ts";
import type { Color, Move, PieceType, Square } from "../chess/types.ts";
import { BLACK, EMPTY, FLAG_CASTLE, FLAG_EN_PASSANT, PAWN, WHITE } from "../chess/types.ts";

export interface TakenPiece {
  type: PieceType;
  /** The chess colour, so the glyph draws in the right fill without being told whose it was. */
  color: Color;
}

export interface MoveRecord {
  /** 1-based, counting every move by either side rather than pairing them. */
  index: number;
  from: Square;
  to: Square;
  /** The destination in algebraic form, which is the only square worth showing. */
  square: string;
  /** Who made it. */
  color: Color;
  /** The glyph to draw. A promotion draws what the pawn became. */
  type: PieceType;
  /** One word: a piece name, or what the move was when the piece is not the point. */
  name: string;
  taken: TakenPiece | null;
  /** The whole move as a sentence, for anything that reads the list aloud. */
  spoken: string;
}

/**
 * The piece a move took, or null.
 *
 * En passant is why this is not just `typeOf(move.captured)`. The pawn it takes was never
 * standing on the destination square, so the move's own `captured` field is empty and the
 * only thing that says a capture happened at all is the flag.
 */
function takenBy(move: Move, mover: Color): TakenPiece | null {
  if ((move.flags & FLAG_EN_PASSANT) !== 0) {
    return { type: PAWN, color: mover === WHITE ? BLACK : WHITE };
  }
  if (move.captured === EMPTY) return null;
  return { type: typeOf(move.captured), color: colorOf(move.captured) };
}

function describe(
  record: Omit<MoveRecord, "spoken">,
  mine: boolean,
  castle: string | null,
): string {
  const who = mine ? "you" : "opponent";
  const taken =
    record.taken === null
      ? ""
      : `, taking ${mine ? "their" : "your"} ${pieceName(record.taken.type)}`;

  if (castle !== null) return `${who} castled ${castle}`;
  if (record.name === "promotes") {
    return `${who} promoted a pawn to ${pieceName(record.type)} on ${record.square}${taken}`;
  }
  return `${who} moved ${record.name} to ${record.square}${taken}`;
}

function record(move: Move, index: number, humanColor: Color): MoveRecord {
  const color = colorOf(move.piece);
  const castle =
    (move.flags & FLAG_CASTLE) === 0 ? null : move.to > move.from ? "short" : "long";
  const promoted = move.promo !== 0;

  /*
   * Three kinds of row, and only one of them names a piece.
   *
   * A castle drawn as "king g1" describes the move without naming it, and a promotion drawn
   * as "pawn e8" hides the only interesting thing that happened. Both take the word that
   * says what the move was, and the glyph carries the rest: the king for a castle, and for
   * a promotion the piece the pawn became, since nothing else promotes.
   */
  const partial = {
    index,
    from: move.from,
    to: move.to,
    square: algebraic(move.to),
    color,
    type: promoted ? move.promo : typeOf(move.piece),
    name: castle !== null ? "castles" : promoted ? "promotes" : pieceName(typeOf(move.piece)),
    taken: takenBy(move, color),
  };

  return { ...partial, spoken: describe(partial, color === humanColor, castle) };
}

/** Every move played so far, oldest first. */
export function moveLog(history: readonly Move[], humanColor: Color): MoveRecord[] {
  return history.map((move, i) => record(move, i + 1, humanColor));
}
