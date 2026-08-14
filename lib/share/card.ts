/**
 * The picture drawn when a game ends, for sharing somewhere else.
 *
 * Built as an SVG string and then rasterised, rather than by reading the page. Screenshotting
 * the DOM would carry the hover states, the cursor, whatever the viewport happened to be, and
 * a board sized for whoever's phone it was. This draws the position again at a fixed size,
 * from the same path data the board itself uses, so the result is the same on every device.
 *
 * No React. `render.ts` next door turns this into a PNG.
 */

import { at } from "../chess/board.ts";
import type { PieceType, Position, Square } from "../chess/types.ts";
import { EMPTY } from "../chess/types.ts";
import { columnOf, rowOf } from "../game/piece-state.ts";
import { PIECE_BODY, PIECE_MARKS, PIECE_VIEWBOX } from "../pieces.ts";
import { squirclePath } from "../squircle.ts";

/** Square, because the board is. Large enough to stay sharp when a platform re-encodes it. */
export const CARD_SIZE = 1080;
const PADDING = 96;
const BOARD = CARD_SIZE - PADDING * 2;
const CELL = BOARD / 8;

/** Room under the board for one line of text, and nothing else. */
export const BOARD_TOP = PADDING;
export const CAPTION_TOP = PADDING + BOARD + 74;

export interface CardColors {
  surface: string;
  boardLight: string;
  boardDark: string;
  lastMove: string;
  check: string;
  pieceWhite: string;
  pieceBlack: string;
}

export interface CardInput {
  position: Position;
  flipped: boolean;
  lastMove: { from: Square; to: Square } | null;
  /** Tinted the way the board tints it, so the picture says how the game ended. */
  matedKing: Square | null;
  colors: CardColors;
}

/**
 * The board and the pieces, at `BOARD` square.
 *
 * Text is deliberately absent. An SVG rasterised through an `Image` gets no access to the
 * page's fonts, so anything drawn here in Geist would silently come out in a system serif.
 * The caption is drawn onto the canvas afterwards instead, where the loaded font applies.
 */
export function cardSvg(input: CardInput): string {
  const { colors } = input;
  const parts: string[] = [];

  const clip = squirclePath({ width: BOARD, height: BOARD, radius: 28 });
  parts.push(`<clipPath id="board"><path d="${clip}"/></clipPath>`);
  parts.push(`<g clip-path="url(#board)">`);

  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const light = (row + column) % 2 === 0;
      parts.push(
        `<rect x="${column * CELL}" y="${row * CELL}" width="${CELL}" height="${CELL}" fill="${
          light ? colors.boardLight : colors.boardDark
        }"/>`,
      );
    }
  }

  // The last move and the mated king, which together are the whole story of the ending.
  const tint = (square: Square, fill: string) => {
    const x = columnOf(square, input.flipped) * CELL;
    const y = rowOf(square, input.flipped) * CELL;
    parts.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${fill}"/>`);
  };
  if (input.lastMove !== null) {
    tint(input.lastMove.from, colors.lastMove);
    tint(input.lastMove.to, colors.lastMove);
  }
  if (input.matedKing !== null) tint(input.matedKing, colors.check);
  parts.push(`</g>`);

  // The same inset the board uses, so a piece sits in its square rather than filling it.
  const inset = CELL * 0.08;
  const glyph = CELL - inset * 2;
  const scale = glyph / PIECE_VIEWBOX;

  for (let square = 0; square < 128; square++) {
    if ((square & 0x88) !== 0) continue;
    const piece = at(input.position.board, square);
    if (piece === EMPTY) continue;

    const white = piece > 0;
    const type = Math.abs(piece) as PieceType;
    const x = columnOf(square, input.flipped) * CELL + inset;
    const y = rowOf(square, input.flipped) * CELL + inset;
    parts.push(
      `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})" fill="${
        white ? colors.pieceWhite : colors.pieceBlack
      }"><path d="${PIECE_BODY}"/><path d="${PIECE_MARKS[type]}"/></g>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD}" height="${BOARD}" ` +
    `viewBox="0 0 ${BOARD} ${BOARD}">${parts.join("")}</svg>`
  );
}

/** A filename someone will recognise in a downloads folder a week later. */
export function cardFilename(result: string): string {
  const slug = result
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `sixtyfour-${slug === "" ? "game" : slug}.png`;
}

export { BOARD as CARD_BOARD_SIZE, PADDING as CARD_PADDING };
