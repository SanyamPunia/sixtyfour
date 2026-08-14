/**
 * Turning the card into a PNG, and getting it somewhere useful.
 *
 * Browser only, and no React. The board arrives as an SVG from `card.ts`, goes through an
 * `Image` onto a canvas, and the caption is drawn on top in the page's own font, which the
 * SVG could not have used.
 */

import type { Color } from "../chess/types.ts";
import { WHITE } from "../chess/types.ts";
import type { CardColors, CardInput } from "./card.ts";
import {
  BOARD_TOP,
  CAPTION_TOP,
  CARD_BOARD_SIZE,
  CARD_PADDING,
  CARD_SIZE,
  cardSvg,
} from "./card.ts";

/** Reads the live tokens, so the picture matches the theme the player is looking at. */
export function readCardColors(): CardColors & {
  ink: string;
  inkSoft: string;
  surface: string;
} {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  };
  return {
    surface: token("--surface", "#fbfbfb"),
    boardLight: token("--board-light", "#fdfdfd"),
    boardDark: token("--board-dark", "#ececec"),
    lastMove: token("--sq-lastmove", "#f7f4ec"),
    check: token("--sq-check", "#f6c9c4"),
    pieceWhite: token("--piece-white", "#9a9a9f"),
    pieceBlack: token("--piece-black", "#232326"),
    ink: token("--ink", "#2a2a2c"),
    inkSoft: token("--ink-soft", "#8a8a90"),
  };
}

function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // A data URL rather than a blob URL. A blob URL for an SVG taints the canvas in some
    // browsers, and a tainted canvas cannot be read back, which is the entire point here.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the board did not rasterise"));
  });
}

export interface RenderInput extends CardInput {
  /** What happened, in the words the status line already used. */
  result: string;
  /** Which side the player was, so the caption can say whose game this was. */
  humanColor: Color;
  moveCount: number;
}

/**
 * Draws the card and hands back a PNG.
 *
 * The caption is two pieces of information and no more: how it ended, and how long it took.
 * A picture of a finished board is already the story, and anything else here would be the
 * only paragraph of text in a product that has none.
 */
export async function renderCard(input: RenderInput): Promise<Blob> {
  const colors = input.colors as CardColors & { ink: string; inkSoft: string; surface: string };
  const canvas = document.createElement("canvas");
  canvas.width = CARD_SIZE;
  canvas.height = CARD_SIZE;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");

  context.fillStyle = colors.surface;
  context.fillRect(0, 0, CARD_SIZE, CARD_SIZE);

  const board = await loadSvg(cardSvg(input));
  context.drawImage(board, CARD_PADDING, BOARD_TOP, CARD_BOARD_SIZE, CARD_BOARD_SIZE);

  // Waited for rather than assumed. A caption drawn before the font arrives is silently
  // rendered in a system serif, and the file is already saved by the time anyone notices.
  await document.fonts.ready;

  const sans = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  context.textBaseline = "alphabetic";

  context.font = `500 40px ${sans}`;
  context.fillStyle = colors.ink;
  context.textAlign = "left";
  context.fillText(input.result.toLowerCase(), CARD_PADDING, CAPTION_TOP);

  const side = input.humanColor === WHITE ? "white" : "black";
  const moves = `${input.moveCount} ${input.moveCount === 1 ? "move" : "moves"}`;
  context.font = `400 28px ${sans}`;
  context.fillStyle = colors.inkSoft;
  context.textAlign = "right";
  context.fillText(`${side}, ${moves}`, CARD_SIZE - CARD_PADDING, CAPTION_TOP);

  return await new Promise((resolve, reject) => {
    // `toBlob` rather than `toDataURL`, which builds a very large string to throw away.
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("the canvas produced nothing"));
      else resolve(blob);
    }, "image/png");
  });
}

/** Whether this browser can put an image on the clipboard at all. */
export function canCopyImages(): boolean {
  return (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

export async function copyImage(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export function downloadImage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
