/**
 * Every sound the product makes, in one place.
 *
 * Three clips, three jobs: `click` for a control, `move` for a piece landing, `capture`
 * for a piece coming off. The move sounds are driven by state and the click by an event
 * handler, but they share the same element handling, the same volumes, and the same
 * failure behaviour, so they share the same module rather than each solving it again.
 *
 * No React here. `components/game/use-move-sound.ts` wraps this for the state-driven half.
 */

const SOURCES = {
  click: "/click.mp3",
  move: "/move.mp3",
  capture: "/capture.mp3",
} as const;

export type SoundName = keyof typeof SOURCES;

/**
 * A click is incidental and happens on top of whatever else is going on, so it sits below
 * the two that report something about the game.
 */
const VOLUMES: Record<SoundName, number> = {
  click: 0.25,
  move: 0.35,
  capture: 0.4,
};

let elements: Map<SoundName, HTMLAudioElement> | null = null;

/**
 * Built on first use rather than at module scope.
 *
 * `Audio` does not exist while rendering on the server, and every caller here runs from an
 * event handler or an effect, so first use is always in the browser.
 */
function registry(): Map<SoundName, HTMLAudioElement> {
  if (elements !== null) return elements;
  elements = new Map();
  for (const [name, source] of Object.entries(SOURCES) as [SoundName, string][]) {
    const element = new Audio(source);
    element.preload = "auto";
    element.volume = VOLUMES[name];
    elements.set(name, element);
  }
  return elements;
}

export function playSound(name: SoundName): void {
  const element = registry().get(name);
  if (element === undefined) return;

  // Rewind rather than wait: two of these can land closer together than the clip is long.
  // Only once there is data, though. Seeking a media element that has not loaded yet makes
  // it abandon its in-flight request and issue another.
  if (element.readyState > HTMLMediaElement.HAVE_NOTHING) element.currentTime = 0;

  element.play().catch(() => {
    // Autoplay is refused until the page has been interacted with. Everything here is
    // triggered by an interaction, so this only fires in odd cases, and a missing sound is
    // not worth an unhandled rejection.
  });
}

/** Warms the elements so the first sound is not late. Safe to call more than once. */
export function preloadSounds(): void {
  registry();
}

export function stopAllSounds(): void {
  if (elements === null) return;
  for (const element of elements.values()) element.pause();
}
