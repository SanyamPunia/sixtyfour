/**
 * Room keys.
 *
 * Six characters from a 31-letter alphabet, which is 887 million keys. That is far more
 * than a five-room cap needs, and the point is not capacity: a key has to be unguessable,
 * because holding one is the only thing that lets you into a room.
 *
 * `0`, `O`, `1`, `I` and `L` are all missing. A key gets read off a screen and typed into
 * a phone, and those five are the pairs people get wrong.
 */

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const KEY_LENGTH = 6;

/**
 * Rejection sampling, not a modulo.
 *
 * 256 is not a multiple of 31, so `byte % 31` would make the first eight letters of the
 * alphabet slightly likelier than the rest. That bias is small, and it is also free to
 * avoid: draw again on the 8 values that would cause it.
 */
const LIMIT = 256 - (256 % ALPHABET.length);

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function generateKey(): string {
  let key = "";
  while (key.length < KEY_LENGTH) {
    // Over-draw, because some of these get thrown away.
    for (const byte of randomBytes(KEY_LENGTH * 2)) {
      if (byte >= LIMIT) continue;
      key += ALPHABET[byte % ALPHABET.length];
      if (key.length === KEY_LENGTH) break;
    }
  }
  return key;
}

/**
 * A secret that proves you are the player who took a seat.
 *
 * The key gets shared, so the key alone cannot be what authorises a move, or anyone who
 * received the link could play for either side. This is per player and never leaves the
 * one browser it was issued to.
 */
export function generateToken(): string {
  return Array.from(randomBytes(24), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A typed key cleaned up for comparison.
 *
 * People paste keys with a trailing space, type them in lower case, and add the dash they
 * saw in a screenshot. All three mean the same room, so all three are accepted rather than
 * rejected with an error the player cannot act on.
 */
export function normalizeKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidKey(input: string): boolean {
  const key = normalizeKey(input);
  if (key.length !== KEY_LENGTH) return false;
  return [...key].every((c) => ALPHABET.includes(c));
}
