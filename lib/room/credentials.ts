/**
 * Remembering which seat this browser is holding.
 *
 * The key gets shared, so the key alone cannot prove anything. The token is what does, and
 * it has to survive a reload or refreshing the page during a game would take the other
 * seat and lock your opponent out of their own room.
 *
 * `sessionStorage`, not `localStorage`. A token belongs to this tab and this sitting. Two
 * tabs on one machine should be able to hold the two seats, which is also how the whole
 * thing gets tested, and a shared token would make that impossible.
 */

const PREFIX = "sixtyfour:seat:";

function store(): Storage | null {
  // Absent while rendering on the server, and blocked outright in some private modes.
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readToken(key: string): string | null {
  try {
    return store()?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function writeToken(key: string, token: string): void {
  try {
    store()?.setItem(PREFIX + key, token);
  } catch {
    // Storage being unavailable costs a seat on reload, and nothing else. Not worth failing
    // a join over.
  }
}

export function forgetToken(key: string): void {
  try {
    store()?.removeItem(PREFIX + key);
  } catch {
    // As above.
  }
}
