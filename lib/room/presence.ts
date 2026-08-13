/**
 * Turning a last-seen timestamp into something honest to put on screen.
 *
 * One mechanism drives all three states. A connected socket writes its timestamp every few
 * seconds, and the value ages once it stops. So the states are just how stale the last
 * write is, and a disconnect needs no separate flag to record it.
 */

import type { Presence } from "./protocol.ts";

/** Written this often while a socket is open, so a live player is always inside `HERE`. */
export const HEARTBEAT_MS = 3_000;

/** Comfortably more than one heartbeat, so a late write does not blink the dot. */
export const HERE_MS = 8_000;

/**
 * How long a vanished player is given before the room admits they are not coming back.
 *
 * Long enough to cover a tab switch, a tunnel, and a laptop lid. Short enough that a
 * player who really did leave is not reported as merely away all afternoon.
 */
export const AWAY_MS = 45_000;

export function presenceOf(lastSeen: number | null, now: number): Presence {
  if (lastSeen === null) return "gone";
  const age = now - lastSeen;
  if (age <= HERE_MS) return "here";
  if (age <= AWAY_MS) return "away";
  return "gone";
}
