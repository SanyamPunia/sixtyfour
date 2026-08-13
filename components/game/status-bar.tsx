"use client";

import { MaterialReadout } from "./material-readout.tsx";
import { TurnDot } from "./turn-dot.tsx";

interface StatusBarProps {
  yourTurn: boolean;
  thinking: boolean;
  whiteToMove: boolean;
  /** Null while the game is live. Already says which ending it was. */
  result: string | null;
  materialLead: number;
}

/**
 * The one line of state above the board: whose turn it is, and who is ahead.
 *
 * Fixed height, so the board does not shift when the material number appears or goes.
 */
export function StatusBar({
  yourTurn,
  thinking,
  whiteToMove,
  result,
  materialLead,
}: StatusBarProps) {
  // A finished game replaces the running state rather than sitting beside it. The turn dot
  // and the material lead are both answers to "what now", and there is no now any more.
  if (result !== null) {
    return (
      <div className="flex h-5 items-center justify-center">
        <p
          role="status"
          className="result-in text-sm font-medium lowercase"
          style={{ color: "var(--ink)" }}
        >
          {result}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-5 items-center justify-center gap-2">
      <TurnDot yourTurn={yourTurn} thinking={thinking} over={false} whiteToMove={whiteToMove} />
      <MaterialReadout lead={materialLead} />
    </div>
  );
}
