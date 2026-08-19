"use client";

import { XIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { WHITE } from "@/lib/chess/types.ts";
import type { MoveRecord } from "@/lib/game/move-log.ts";
import { cn } from "@/lib/utils.ts";
import { PieceGlyph } from "./pieces/glyphs.tsx";

/**
 * Beside the board on a wide screen, under it on a narrow one.
 *
 * The two are the same rows in the two directions a list can run, so they share this
 * component rather than being written twice. A phone has no room to the side of a board that
 * is already capped against the viewport height, and it does have about 200px of vertical
 * slack, so the list turns and scrolls sideways there instead.
 */
export type MoveListLayout = "column" | "strip";

/**
 * How near an end counts as being at it, in pixels.
 *
 * `scrollWidth` and `scrollHeight` are integers rounded up from a content box that is not,
 * so a scroller sitting hard against one end reports an offset a pixel or two short of the
 * arithmetic maximum. At 1px of slack that read as more list, and the trailing edge stayed
 * faded over a row that was already fully in view.
 */
const EDGE_SLACK = 2;

interface MoveListProps {
  moves: readonly MoveRecord[];
  layout: MoveListLayout;
  /**
   * Asks the board to mark a move, by its index in this list. Called with null on the way
   * out, which puts the real last move back.
   *
   * An index rather than the two squares, so a list that gets shorter takes its own preview
   * with it. A room can roll a move back, and squares held here would go on marking a move
   * that no longer happened.
   */
  onPreview: (index: number | null) => void;
}

export function MoveList({ moves, layout, onPreview }: MoveListProps) {
  const scroller = useRef<HTMLOListElement>(null);
  const column = layout === "column";

  /*
   * Marks whichever edge still has list behind it, so the stylesheet can fade that edge.
   *
   * Written as attributes rather than held in state. It changes on every frame of a scroll,
   * and routing that through React would re-render every row to fade two edges of their
   * container. The board writes its own hover the same way and for the same reason.
   *
   * Position-aware rather than a constant fade at both ends. The list sits at its newest
   * row, so a fade that is always there would permanently dim the one move a player is most
   * likely to be looking for.
   */
  const syncFades = useCallback((): void => {
    const el = scroller.current;
    if (el === null) return;
    const [offset, visible, total] = column
      ? [el.scrollTop, el.clientHeight, el.scrollHeight]
      : [el.scrollLeft, el.clientWidth, el.scrollWidth];
    el.toggleAttribute("data-fade-start", offset > EDGE_SLACK);
    el.toggleAttribute("data-fade-end", offset + visible < total - EDGE_SLACK);
  }, [column]);

  /*
   * The newest move is the one being waited for, so it is the one that must be on screen.
   *
   * Written straight to the scroll offset rather than through `scrollIntoView`, which walks
   * up the ancestors and would shift the page to bring a row into view. `scroll-behavior` is
   * set in the stylesheet, where the reduced-motion block can turn it off.
   *
   * The fades are resynced here as well as on the scroll itself, because a new row changes
   * the scroll extent without moving the element, which is a change no scroll event and no
   * `ResizeObserver` reports.
   */
  useEffect(() => {
    const el = scroller.current;
    if (el === null || moves.length === 0) return;
    // Only when there is something to scroll. Early in a game the whole list is on screen.
    if (column) {
      if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
    } else if (el.scrollWidth > el.clientWidth) {
      el.scrollLeft = el.scrollWidth;
    }
    syncFades();
  }, [moves.length, column, syncFades]);

  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    syncFades();
    el.addEventListener("scroll", syncFades, { passive: true });
    // The element's own box changes with the window, and the board it is measured against is
    // capped by viewport height, so a resize can make a list that fitted stop fitting.
    const observer = new ResizeObserver(() => {
      const scroll = scroller.current;
      if (scroll === null) return;
      /*
       * Stay at the end across a resize, unless the reader has scrolled back.
       *
       * A shrinking window keeps the offset and takes the visible height, which walks the
       * newest move off the bottom of a list that was sitting on it. `data-fade-end` is
       * absent exactly when there was nothing below, and it still holds the pre-resize
       * answer here because `syncFades` has not run yet.
       */
      if (!scroll.hasAttribute("data-fade-end")) {
        if (column) scroll.scrollTop = scroll.scrollHeight;
        else scroll.scrollLeft = scroll.scrollWidth;
      }
      syncFades();
    });
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", syncFades);
      observer.disconnect();
    };
  }, [syncFades, column]);

  /*
   * Rendered even with nothing in it, which is not a detail.
   *
   * Returning null before the first move left `scroller.current` null through the first
   * render, and the effect above attaches on mount and has no dependency that changes when a
   * row finally arrives. So it returned early, and the scroll listener and the observer were
   * never attached for the whole game: the fades stayed off no matter where the list was
   * scrolled to. An empty list draws nothing anyway.
   */
  return (
    <ol
      ref={scroller}
      aria-label="Moves played"
      // Leaving by any route clears the mark, including a pointer that leaves the list
      // between two rows rather than out of one.
      onPointerLeave={() => onPreview(null)}
      data-axis={column ? "column" : "strip"}
      className={cn(
        "move-scroller min-w-0 list-none",
        column
          ? // `h-full` is what makes this scroll. `overflow-y-auto` on an auto-height block
            // has no height to scroll within, so the list grew instead: it ran past the
            // bottom of its own wrapper, past the board, and off the page, and the scrollbar
            // that appeared on every move was the document's, not this one's.
            "flex h-full flex-col gap-px overflow-y-auto overflow-x-hidden"
          : // Wide enough that the square ending one move does not read as part of the
            // number starting the next. At `gap-1` the row was one unbroken line of text.
            "flex flex-row items-center gap-4 overflow-x-auto overflow-y-hidden py-1",
      )}
    >
      {moves.map((move) => (
        <li
          key={move.index}
          className={cn(
            // `relative` is load-bearing. `sr-only` is absolutely positioned, and without a
            // containing block on the row it resolves against the nearest positioned
            // ancestor outside the scroller, escapes the overflow clip, and lands at its
            // static offset inside the scrolled content. In the strip that is off the right
            // of a phone, which gave the whole page a horizontal scrollbar.
            "move-row relative flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1",
            "text-xs transition-colors duration-150 hover:bg-[var(--board-dark)]",
          )}
          onPointerEnter={() => onPreview(move.index)}
        >
          {/*
            The whole move as one sentence, and the painted row is hidden from the reader
            underneath it. Read piecemeal it comes out as "6 knight f3", which is three
            fragments rather than a move.
          */}
          <span className="sr-only">{move.spoken}</span>

          <span
            aria-hidden="true"
            className={cn(
              "shrink-0 text-right font-mono tabular-nums",
              column ? "w-5" : "w-3.5",
            )}
            style={{ color: "var(--ink-soft)" }}
          >
            {move.index}
          </span>

          <span aria-hidden="true" className="size-3.5 shrink-0">
            <PieceGlyph type={move.type} white={move.color === WHITE} />
          </span>

          <span aria-hidden="true" className={cn(column && "min-w-0 flex-1 truncate")}>
            {move.name}
          </span>

          {move.taken === null ? null : (
            <span aria-hidden="true" className="flex shrink-0 items-center">
              <XIcon className="size-2.5" style={{ color: "var(--ink-soft)" }} />
              <span className="size-3.5">
                <PieceGlyph type={move.taken.type} white={move.taken.color === WHITE} />
              </span>
            </span>
          )}

          <span
            aria-hidden="true"
            className="shrink-0 font-mono tabular-nums"
            style={{ color: "var(--ink-soft)" }}
          >
            {move.square}
          </span>
        </li>
      ))}
    </ol>
  );
}
