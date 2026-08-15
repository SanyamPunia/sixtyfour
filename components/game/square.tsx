import type { KeyboardEvent, PointerEvent } from "react";
import type { Square as SquareIndex } from "@/lib/chess/types.ts";
import { cn } from "@/lib/utils.ts";

export interface SquareState {
  selected: boolean;
  lastMove: boolean;
  /** A legal destination. `capture` swaps the dot for a ring. */
  hint: "none" | "move" | "capture";
  /** Stagger order for the hint, by distance from the piece that was picked up. */
  hintIndex: number;
  check: boolean;
}

interface SquareProps extends SquareState {
  square: SquareIndex;
  label: string;
  dark: boolean;
  /**
   * The side facing the other square of the same move, when the two are touching.
   *
   * Screen-relative, so it is worked out after the board has been turned round rather than
   * from the files and ranks.
   */
  seam?: "Top" | "Right" | "Bottom" | "Left";
  movable: boolean;
  onSelect: (square: SquareIndex) => void;
  /** Reports the hovered square so the board can mark the piece sitting on it. */
  onHover: (square: SquareIndex | null) => void;
  /** True for the one square that holds the board's single tab stop. */
  tabStop: boolean;
  /** Arrow keys move the tab stop. Handled here rather than on a wrapper, so the event
      arrives on the focused control instead of relying on it bubbling. */
  onArrowKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Starts a drag when this square holds one of the player's movable pieces. */
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, square: SquareIndex) => void;
  /** Drives the grab cursor. Narrower than `movable`, which includes destinations. */
  grabbable: boolean;
}

/**
 * One board square.
 *
 * State paints as absolutely positioned children rather than as a background on the
 * button, so a tint and a hint can sit on the same square without one replacing the other.
 */
export function Square({
  square,
  label,
  dark,
  movable,
  selected,
  lastMove,
  hint,
  hintIndex,
  check,
  onSelect,
  onHover,
  tabStop,
  onArrowKey,
  onPointerDown,
  grabbable,
  seam,
}: SquareProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-sq={square}
      tabIndex={tabStop ? 0 : -1}
      data-movable={movable || undefined}
      className={cn(
        "sq relative aspect-square touch-manipulation select-none outline-none",
        "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-inset",
        movable && "cursor-pointer",
        grabbable && "cursor-grab",
      )}
      style={{ background: dark ? "var(--board-dark)" : "var(--board-light)" }}
      onClick={() => onSelect(square)}
      onKeyDown={onArrowKey}
      onPointerDown={(event) => onPointerDown(event, square)}
      onPointerEnter={() => onHover(movable ? square : null)}
      onPointerLeave={() => onHover(null)}
    >
      {lastMove && (
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background: "var(--sq-lastmove)",
            // One edge, and only when the other marked square is against it.
            ...(seam === undefined
              ? {}
              : { [`border${seam}`]: "1px solid var(--sq-lastmove-seam)" }),
          }}
        />
      )}
      {selected && (
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: "var(--sq-select)" }}
        />
      )}
      {check && (
        <span
          aria-hidden="true"
          className="check-pulse absolute inset-0"
          style={{ background: "var(--sq-check)" }}
        />
      )}
      {hint === "move" && (
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
          <span
            className="hint-dot block size-[16%] rounded-full"
            style={{
              background: "var(--sq-hint)",
              ["--hint-index" as string]: hintIndex,
            }}
          />
        </span>
      )}
      {hint === "capture" && (
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
          {/* A thin inset ring. A heavy circle around the piece reads as a target
              reticle rather than as an available capture. */}
          <span
            className="hint-ring block size-[92%] rounded-full border-[3px]"
            style={{
              borderColor: "var(--sq-hint)",
              ["--hint-index" as string]: hintIndex,
            }}
          />
        </span>
      )}
    </button>
  );
}
