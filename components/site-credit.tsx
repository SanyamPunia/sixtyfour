/**
 * The one piece of chrome that is not about the game.
 *
 * Pinned to the bottom right rather than placed in the column, so it never competes with
 * the board for the centre. It stays in `--ink-soft` until hovered, which puts it below
 * every game element in the visual order, where a credit belongs.
 */

/** X's logo, a trademark of X Corp, used here to point at a profile. */
function XLogo() {
  return (
    <svg viewBox="0 0 1200 1227" aria-hidden="true" className="size-3.5" fill="currentColor">
      <path d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026ZM569.165 687.828l-47.468-67.894-377.686-540.24h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854v-.026Z" />
    </svg>
  );
}

const LINK =
  "rounded-sm outline-none transition-colors duration-200 hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]";

export function SiteCredit() {
  return (
    <footer
      className="fixed right-4 bottom-4 z-30 flex items-center gap-2.5 text-xs"
      style={{ color: "var(--ink-soft)" }}
    >
      <a href="https://sanyam.sh" target="_blank" rel="noopener noreferrer" className={LINK}>
        created by sanyam
      </a>
      <span
        aria-hidden="true"
        className="inline-block size-0.5 shrink-0 rounded-full"
        style={{ background: "currentColor" }}
      />
      <a
        href="https://x.com/sanyampunia"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Sanyam on X"
        className={LINK}
      >
        <XLogo />
      </a>
    </footer>
  );
}
