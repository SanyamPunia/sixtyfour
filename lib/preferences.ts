/**
 * The handful of choices that outlive a game.
 *
 * The theme is not here. It has to be applied before the first paint or the page flashes
 * the wrong colour, so an inline script in the document head owns it. These three only
 * affect a control's icon or the board's orientation, and are restored on mount, which
 * costs at most one frame during the piece entrance animation.
 *
 * Every read is guarded: private browsing throws on access rather than returning null.
 */

export type Difficulty = "easy" | "medium" | "hard";
export type Side = "white" | "black";

const KEYS = {
  difficulty: "sixtyfour-difficulty",
  side: "sixtyfour-side",
  muted: "sixtyfour-muted",
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing. The choice still holds for this session.
  }
}

export function readDifficulty(): Difficulty | null {
  const stored = read(KEYS.difficulty);
  return stored === "easy" || stored === "medium" || stored === "hard" ? stored : null;
}

export function writeDifficulty(value: Difficulty): void {
  write(KEYS.difficulty, value);
}

export function readSide(): Side | null {
  const stored = read(KEYS.side);
  return stored === "white" || stored === "black" ? stored : null;
}

export function writeSide(value: Side): void {
  write(KEYS.side, value);
}

export function readMuted(): boolean {
  return read(KEYS.muted) === "true";
}

export function writeMuted(value: boolean): void {
  write(KEYS.muted, String(value));
}
