"use client";

import { MaterialReadout } from "./material-readout.tsx";
import { TurnDot } from "./turn-dot.tsx";

interface StatusBarProps {
  yourTurn: boolean;
  thinking: boolean;
  over: boolean;
  materialLead: number;
}

/**
 * The one line of state above the board: whose turn it is, and who is ahead.
 *
 * Fixed height, so the board does not shift when the material number appears or goes.
 */
export function StatusBar({ yourTurn, thinking, over, materialLead }: StatusBarProps) {
  return (
    <div className="flex h-5 items-center justify-center gap-2">
      <TurnDot yourTurn={yourTurn} thinking={thinking} over={over} />
      <MaterialReadout lead={materialLead} />
    </div>
  );
}
