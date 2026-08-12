"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { SmoothCorners } from "@/components/smooth-corners.tsx";
import { at, fileOf, rankOf } from "@/lib/chess/board.ts";
import { describeSquare } from "@/lib/chess/notation.ts";
import { isCapture } from "@/lib/chess/rules.ts";
import type { Color, Move, Position, Square as SquareIndex } from "@/lib/chess/types.ts";
import { EMPTY } from "@/lib/chess/types.ts";
import { Piece } from "./piece.tsx";
import { type PieceView, squareAt } from "./piece-state.ts";
import { Square, type SquareState } from "./square.tsx";
import { usePieceDrag } from "./use-piece-drag.ts";

interface BoardProps {
  position: Position;
  pieces: readonly PieceView[];
  humanColor: Color;
  selected: SquareIndex | null;
  legalTargets: readonly Move[];
  lastMove: { from: SquareIndex; to: SquareIndex } | null;
  checkedKing: SquareIndex | null;
  matedKing: SquareIndex | null;
  castlingRookId: string | null;
  interactive: boolean;
  shakeToken: number;
  resetToken: number;
  onGrab: (square: SquareIndex) => void;
  onSelect: (square: SquareIndex) => void;
}

/**
 * Board corner radius, in pixels.
 *
 * Smoothing spreads a continuous corner over `(1 + smoothing) * radius` of each edge, so
 * this reads larger than the number suggests: at 0.6 smoothing, 14 occupies 22px. The
 * previous 26 took 42px, which curled the corner squares enough to read as a rounded card
 * rather than a board.
 */
const BOARD_RADIUS = 14;

/** Chebyshev distance, so hints ripple outward in rings rather than by raw index. */
function ringDistance(from: SquareIndex, to: SquareIndex): number {
  return Math.max(Math.abs(fileOf(from) - fileOf(to)), Math.abs(rankOf(from) - rankOf(to)));
}

export function Board({
  position,
  pieces,
  humanColor,
  selected,
  legalTargets,
  lastMove,
  checkedKing,
  matedKing,
  castlingRookId,
  interactive,
  shakeToken,
  resetToken,
  onGrab,
  onSelect,
}: BoardProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * Roving tabindex.
   *
   * 64 buttons in the tab order means 64 presses to get past the board. One square holds
   * the tab stop and the arrow keys move it, which is the standard pattern for a grid of
   * controls. This one is React state rather than a ref, because it changes only on an
   * arrow press and it has to re-render to move the tab stop.
   */
  const [focusSquare, setFocusSquare] = useState<SquareIndex>(() => squareAt(6, 4));

  const onArrowKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const deltas: Record<string, [row: number, column: number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    event.preventDefault();

    const row = 7 - rankOf(focusSquare);
    const column = fileOf(focusSquare);
    const nextRow = Math.min(7, Math.max(0, row + delta[0]));
    const nextColumn = Math.min(7, Math.max(0, column + delta[1]));
    const next = squareAt(nextRow, nextColumn);
    setFocusSquare(next);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-sq="${next}"]`)?.focus();
  };

  /**
   * Hover and shake are written straight to the DOM rather than held in state.
   *
   * Both are transient interaction feedback, and both would otherwise re-render 96
   * elements on every pointer crossing. The square and the piece also live in separate
   * layers, so no CSS selector can reach from one to the other.
   */
  const setHovered = (square: SquareIndex | null): void => {
    const layer = layerRef.current;
    if (layer === null) return;
    for (const node of layer.querySelectorAll("[data-hovered]")) {
      node.removeAttribute("data-hovered");
    }
    if (square === null) return;
    layer.querySelector(`[data-square="${square}"]`)?.setAttribute("data-hovered", "true");
  };

  useEffect(() => {
    if (shakeToken === 0) return;
    const layer = layerRef.current;
    if (layer === null) return;
    /**
     * The body, not the outer piece.
     *
     * `.piece` permanently declares `animation: piece-in`. Putting `.shake` on it replaced
     * that shorthand, and removing the class changed `animation-name` back, which starts
     * an animation fresh rather than leaving it finished. The entrance then replayed after
     * every shake: `from { opacity: 0 }` plus a `backwards` fill through its stagger delay,
     * so the piece blanked for a moment and faded back in. The body declares no animation,
     * so removing the class falls back to nothing.
     */
    const held = layer.querySelector('[data-lifted="true"] .piece-body');
    if (held === null) return;

    // Re-adding the class is what replays the animation. Reading offsetWidth forces the
    // style flush in between, without which the browser coalesces both changes into none.
    held.classList.remove("shake");
    void (held as HTMLElement).offsetWidth;
    held.classList.add("shake");
    const done = () => held.classList.remove("shake");
    held.addEventListener("animationend", done, { once: true });
    return () => held.removeEventListener("animationend", done);
  }, [shakeToken]);

  useEffect(() => {
    if (resetToken === 0) return;
    const layer = layerRef.current;
    if (layer === null) return;
    // Held only for the length of the reset, so ordinary moves keep their own timing.
    layer.setAttribute("data-resetting", "true");
    const timer = setTimeout(() => layer.removeAttribute("data-resetting"), 700);
    return () => {
      clearTimeout(timer);
      layer.removeAttribute("data-resetting");
    };
  }, [resetToken]);

  const targetBySquare = new Map<SquareIndex, Move>();
  for (const move of legalTargets) targetBySquare.set(move.to, move);

  const grabbable = (square: SquareIndex): boolean => {
    const occupant = at(position.board, square);
    return occupant !== EMPTY && Math.sign(occupant) === position.side;
  };

  const dragging = usePieceDrag({
    layerRef,
    enabled: interactive,
    isGrabbable: grabbable,
    onGrab,
    onDrop: onSelect,
  });

  // A drop already moved the piece. The click that follows would re-enter selection.
  const handleSelect = (square: SquareIndex): void => {
    if (dragging.consumeClick()) return;
    onSelect(square);
  };

  const squares = [];
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const square = squareAt(row, column);
      const target = targetBySquare.get(square);
      const occupant = at(position.board, square);
      const capturing = target !== undefined && isCapture(target);

      const state: SquareState = {
        selected: selected === square,
        lastMove: lastMove !== null && (lastMove.from === square || lastMove.to === square),
        hint: target === undefined ? "none" : capturing ? "capture" : "move",
        hintIndex: selected === null ? 0 : ringDistance(selected, square),
        check: checkedKing === square,
      };

      squares.push(
        <Square
          key={square}
          square={square}
          label={describeSquare(position, square, humanColor)}
          dark={(row + column) % 2 === 1}
          movable={
            interactive &&
            (target !== undefined ||
              (occupant !== EMPTY && Math.sign(occupant) === position.side))
          }
          onSelect={handleSelect}
          onPointerDown={dragging.onPointerDown}
          onHover={setHovered}
          grabbable={interactive && grabbable(square)}
          onArrowKey={onArrowKey}
          tabStop={focusSquare === square}
          {...state}
        />,
      );
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a board is not a form grouping, and fieldset brings layout defaults we would only have to undo
    <div
      ref={gridRef}
      role="group"
      aria-label="Chess board"
      className="board-surface relative w-full"
    >
      <SmoothCorners radius={BOARD_RADIUS} className="grid grid-cols-8 overflow-hidden">
        {squares}
      </SmoothCorners>
      {/* Pieces sit outside the clip, so a lifted piece near a corner is not cut off. */}
      <div ref={layerRef} className="piece-layer pointer-events-none absolute inset-0">
        {pieces.map((piece) => (
          <Piece
            key={piece.id}
            piece={piece}
            humanColor={humanColor}
            lifted={selected === piece.square && !piece.captured}
            mated={matedKing === piece.square}
            castlingRook={castlingRookId === piece.id}
            enterDelay={Math.abs(fileOf(piece.square) - 3.5)}
          />
        ))}
      </div>
    </div>
  );
}
