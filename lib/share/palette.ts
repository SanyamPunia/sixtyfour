/**
 * The backgrounds a player can mount the picture on.
 *
 * Ordered warm to cool, with the two dark mounts last. The row is read left to right and a
 * scale is easier to choose from than a scatter.
 *
 * No React and no hex here. The values are tokens, read from the document when the card is
 * drawn, so this list stays a list of names.
 */

export interface CardBackground {
  id: string;
  /** Read aloud, and shown as the tooltip. */
  label: string;
  /** The token holding the fill, or null to follow the interface's own surface. */
  token: string | null;
}

export const CARD_BACKGROUNDS: readonly CardBackground[] = [
  // First, and the default. Whatever the player is already looking at.
  { id: "theme", label: "Match the app", token: null },
  { id: "paper", label: "Paper", token: "--card-paper" },
  { id: "sand", label: "Sand", token: "--card-sand" },
  { id: "blush", label: "Blush", token: "--card-blush" },
  { id: "sage", label: "Sage", token: "--card-sage" },
  { id: "mist", label: "Mist", token: "--card-mist" },
  { id: "lilac", label: "Lilac", token: "--card-lilac" },
  { id: "slate", label: "Slate", token: "--card-slate" },
  { id: "charcoal", label: "Charcoal", token: "--card-charcoal" },
];

export const DEFAULT_BACKGROUND = "theme";

/**
 * Perceived lightness of a colour, 0 to 1.
 *
 * Used to decide which of the two text pairs a background needs. Deriving it beats storing
 * a text colour beside each swatch, because the two cannot then drift apart, and adding a
 * background later cannot forget to bring legible text with it.
 */
export function lightnessOf(color: string): number {
  const rgb = parseColor(color);
  if (rgb === null) return 1;
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Handles the two forms a computed style can hand back: `#rrggbb` and `rgb(r, g, b)`. */
function parseColor(color: string): [number, number, number] | null {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const digits = hex[1] as string;
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((d) => d + d)
            .join("")
        : digits;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgb !== null) {
    const parts = (rgb[1] as string).split(/[\s,/]+/).filter((p) => p !== "");
    if (parts.length < 3) return null;
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
  }
  return null;
}

/** Above this a background takes dark text, below it light. */
export const LIGHT_THRESHOLD = 0.4;
