"use client";

import { useEffect, useRef } from "react";
import { playSound, preloadSounds, stopAllSounds } from "@/lib/sound.ts";

/**
 * Plays a sound whenever a move lands, from either side, and a different one for a capture.
 *
 * It watches the move count rather than hooking the two places a move can come from. A
 * human move and a bot reply are the same event to a listener, and the count is the one
 * value that already rises for both.
 */
export function useMoveSound(moveCount: number, wasCapture: boolean): void {
  const lastPlayed = useRef(moveCount);

  useEffect(() => {
    preloadSounds();
    return stopAllSounds;
  }, []);

  useEffect(() => {
    const previous = lastPlayed.current;
    lastPlayed.current = moveCount;

    // Only on an increase. A new game resets the count, and starting one should not sound
    // like thirty moves being unplayed.
    if (moveCount <= previous) return;

    playSound(wasCapture ? "capture" : "move");
    // Both values derive from the same history, so `wasCapture` cannot change without the
    // count changing. Listing it is honest, and the guard above makes a spurious re-run a
    // no-op rather than a second sound.
  }, [moveCount, wasCapture]);
}
