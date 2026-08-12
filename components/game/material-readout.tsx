"use client";

/**
 * The material lead, and the only visible text in the product.
 *
 * It renders nothing while the game is level, which is most of a game. A readout showing
 * "0" for twenty moves is noise wearing the costume of information.
 */
export function MaterialReadout({ lead }: { lead: number }) {
  if (lead === 0) return null;

  const magnitude = Math.abs(lead);

  return (
    <p role="status" className="font-mono text-sm tabular-nums" style={{ color: "var(--ink)" }}>
      {/* Keyed on the value so each change remounts and replays the roll. */}
      <span key={lead} aria-hidden="true" className="digit-roll inline-block">
        {lead > 0 ? "+" : "-"}
        {magnitude}
      </span>
      <span className="sr-only">
        {magnitude} {magnitude === 1 ? "pawn" : "pawns"} {lead > 0 ? "ahead" : "behind"}
      </span>
    </p>
  );
}
