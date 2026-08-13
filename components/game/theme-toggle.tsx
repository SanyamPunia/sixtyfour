"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";

export const THEME_STORAGE_KEY = "sixtyfour-theme";

/**
 * Light is the default, and the choice is the player's rather than the system's.
 *
 * Both icons are rendered and CSS picks one from `data-theme` on the root. Deciding in
 * JavaScript would mean the server rendering one icon and the client swapping it after
 * hydration, which is a visible flash on every load for anyone using dark.
 *
 * They stack rather than one being removed, so the change can be animated. See
 * `.swap-icons` in globals.css.
 */
export function ThemeToggle() {
  const toggle = (): void => {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing. The theme still applies for this session.
    }
  };

  return (
    <Tooltip label="Toggle theme">
      <Button aria-label="Toggle light and dark theme" onClick={toggle}>
        <span className="swap-icons size-[18px]">
          <MoonIcon className="icon-to-dark size-[18px]" aria-hidden="true" />
          <SunIcon className="icon-to-light size-[18px]" aria-hidden="true" />
        </span>
      </Button>
    </Tooltip>
  );
}
