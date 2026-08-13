"use client";

import type { Presence } from "@/lib/room/protocol.ts";
import { MaterialReadout } from "./material-readout.tsx";
import { PresenceDot } from "./presence-dot.tsx";
import { TurnDot } from "./turn-dot.tsx";

interface StatusBarProps {
  yourTurn: boolean;
  thinking: boolean;
  whiteToMove: boolean;
  /** Null while the game is live. Already says which ending it was. */
  result: string | null;
  materialLead: number;
  /** Set only in a room, and only while the other seat is not occupied and answering. */
  waitingOn: Presence | null;
}

const WAITING: Record<Presence, string> = {
  here: "",
  away: "opponent away",
  gone: "waiting for an opponent",
};

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
  waitingOn,
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

  // An empty or silent seat replaces the turn line rather than crowding it. Whose move it
  // is does not matter while there is nobody to make the other one.
  if (waitingOn !== null && waitingOn !== "here") {
    return (
      <div className="flex h-5 items-center justify-center gap-2">
        <PresenceDot presence={waitingOn} />
        <p role="status" className="text-sm lowercase" style={{ color: "var(--ink-soft)" }}>
          {WAITING[waitingOn]}
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
