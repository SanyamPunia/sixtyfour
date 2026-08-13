"use client";

import { MaterialReadout } from "./material-readout.tsx";
import { TurnDot } from "./turn-dot.tsx";

interface StatusBarProps {
  yourTurn: boolean;
  thinking: boolean;
  /** Null while the game is live. */
  outcome: "win" | "loss" | "draw" | null;
  materialLead: number;
}

const RESULT: Record<"win" | "loss" | "draw", string> = {
  win: "you win",
  loss: "you lose",
  draw: "draw",
};

/**
 * The one line of state above the board: whose turn it is, and who is ahead.
 *
 * Fixed height, so the board does not shift when the material number appears or goes.
 */
export function StatusBar({ yourTurn, thinking, outcome, materialLead }: StatusBarProps) {
  // A finished game replaces the running state rather than sitting beside it. The turn dot
  // and the material lead are both answers to "what now", and there is no now any more.
  if (outcome !== null) {
    return (
      <div className="flex h-5 items-center justify-center">
        <p
          role="status"
          className="result-in text-sm font-medium lowercase"
          style={{ color: "var(--ink)" }}
        >
          {RESULT[outcome]}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-5 items-center justify-center gap-2">
      <TurnDot yourTurn={yourTurn} thinking={thinking} over={false} />
      <MaterialReadout lead={materialLead} />
    </div>
  );
}
