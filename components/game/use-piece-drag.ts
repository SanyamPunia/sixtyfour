"use client";

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useRef } from "react";
import type { Square } from "@/lib/chess/types.ts";

/** Below this, the gesture is a tap and the existing click path handles it. */
const DRAG_THRESHOLD_PX = 4;

interface PieceDragOptions {
  layerRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  /** True for a square holding one of the player's pieces that has somewhere to go. */
  isGrabbable: (square: Square) => boolean;
  /** Selects the square, so the hints are up before the piece has travelled far. */
  onGrab: (square: Square) => void;
  /** Called with the square under the pointer on release. */
  onDrop: (square: Square) => void;
}

interface DragState {
  pointerId: number;
  from: Square;
  element: HTMLElement;
  startX: number;
  startY: number;
  moved: boolean;
}

/**
 * Drag a piece to any legal square.
 *
 * This reuses the overlay rather than adding a second way to position a piece. A drag sets
 * the standalone `translate` property, which is applied before `transform` and so composes
 * with the square-based position already there. Neither has to know about the other.
 *
 * Tap is untouched. Nothing is dispatched until the pointer passes the threshold, so a
 * press that never moves falls through to the click handler exactly as before. Without
 * that, selecting on press and then toggling on click would cancel each other out and a
 * tap would appear to do nothing.
 *
 * The drag itself lives in a ref. It updates on every pointer move, and routing that
 * through React would re-render 96 elements per frame to move one of them.
 */
export function usePieceDrag({
  layerRef,
  enabled,
  isGrabbable,
  onGrab,
  onDrop,
}: PieceDragOptions) {
  const drag = useRef<DragState | null>(null);
  const swallowClick = useRef(false);

  const finish = (state: DragState): void => {
    state.element.removeAttribute("data-dragging");
    drag.current = null;
  };

  const snapBack = (state: DragState): void => {
    const { element } = state;
    element.removeAttribute("data-dragging");
    element.setAttribute("data-returning", "true");
    element.style.translate = "0px 0px";
    const done = () => {
      element.removeAttribute("data-returning");
      element.style.translate = "";
    };
    element.addEventListener("transitionend", done, { once: true });
    drag.current = null;
  };

  const onPointerMove = (event: PointerEvent): void => {
    const state = drag.current;
    if (state === null || event.pointerId !== state.pointerId) return;

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;

    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!state.moved) {
      state.moved = true;
      state.element.setAttribute("data-dragging", "true");
      onGrab(state.from);
    }
    state.element.style.translate = `${dx}px ${dy}px`;
  };

  const onPointerUp = (event: PointerEvent): void => {
    const state = drag.current;
    if (state === null || event.pointerId !== state.pointerId) return;

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);

    if (!state.moved) {
      drag.current = null;
      return;
    }

    // A drag ends in a drop, not a click. The click that follows would re-enter the
    // selection logic and undo the move.
    swallowClick.current = true;

    const under = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-sq]");
    const target = under === null || under === undefined ? null : Number(under.dataset.sq);

    if (target === null) {
      snapBack(state);
      return;
    }

    /*
     * Clear the offset and drop in the same synchronous block. React flushes the new
     * square's transform before the browser paints, and `data-dragging` still has the
     * transition switched off, so the piece appears at the target rather than rubber
     * banding back to its origin and animating across. A player who dragged a piece
     * somewhere does not want to watch it travel there afterwards.
     */
    state.element.style.translate = "";
    onDrop(target);
    requestAnimationFrame(() => finish(state));
  };

  const onPointerCancel = (event: PointerEvent): void => {
    const state = drag.current;
    if (state === null || event.pointerId !== state.pointerId) return;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    if (state.moved) snapBack(state);
    else drag.current = null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, square: Square): void => {
    if (!enabled || event.button !== 0) return;
    if (!isGrabbable(square)) return;

    const element = layerRef.current?.querySelector<HTMLElement>(`[data-square="${square}"]`);
    if (element === null || element === undefined) return;

    drag.current = {
      pointerId: event.pointerId,
      from: square,
      element,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };

    // Listening on the window rather than the square, so the piece keeps following once
    // the pointer leaves the square it started on, which it does immediately.
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  };

  /** True once per drag, so the click that follows a drop is ignored. */
  const consumeClick = (): boolean => {
    if (!swallowClick.current) return false;
    swallowClick.current = false;
    return true;
  };

  return { onPointerDown, consumeClick };
}
