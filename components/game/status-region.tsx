import type { GameState } from "@/lib/game/reducer.ts";

/**
 * The only running commentary the game has, and it is invisible.
 *
 * The page shows no text, so everything a sighted player reads from tint and motion has to
 * be said here instead. `aria-live="polite"` waits for a pause rather than interrupting.
 */
export function StatusRegion({ state }: { state: GameState }) {
  return (
    <p aria-live="polite" className="sr-only">
      {describe(state)}
    </p>
  );
}

function describe(state: GameState): string {
  const yourTurn = state.position.side === state.humanColor;

  switch (state.status) {
    case "checkmate":
      return yourTurn ? "checkmate, you lose" : "checkmate, you win";
    case "stalemate":
      return "stalemate, the game is a draw";
    case "draw-fifty-move":
      return "draw by the fifty move rule";
    case "draw-repetition":
      return "draw by threefold repetition";
    case "draw-insufficient":
      return "draw, neither side can mate";
    case "check":
      return yourTurn ? "you are in check" : "the opponent is in check";
    default:
      if (state.thinking) return "opponent thinking";
      return yourTurn ? "your move" : "opponent to move";
  }
}
