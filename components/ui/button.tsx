"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { playSound } from "@/lib/sound.ts";
import { cn } from "@/lib/utils.ts";

/**
 * Height comes from `size`, never from an `h-*` override at a call site. Two tiers is the
 * whole scale: `control` for anything on the board surface, `dialog` for a modal's
 * primary action.
 */
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-all duration-200 outline-none select-none active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        // Unfilled at rest. The board is the only thing on screen that should carry weight.
        board:
          "bg-transparent text-[var(--ink-soft)] hover:bg-[var(--board-dark)] hover:text-[var(--ink)] aria-expanded:bg-[var(--board-dark)] aria-expanded:text-[var(--ink)]",
        quiet:
          "bg-transparent text-[var(--ink-soft)] hover:bg-[var(--board-dark)] hover:text-[var(--ink)]",
        danger: "bg-[var(--danger)] text-[var(--danger-ink)] hover:brightness-95",
      },
      size: {
        control: "size-10 shrink-0 p-0",
        dialog: "h-10 px-4 text-sm",
      },
    },
    defaultVariants: { variant: "board", size: "control" },
  },
);

export interface ButtonProps
  extends ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  onClick,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      // Every control sounds the same, so it lives on the shared primitive rather than
      // being remembered at each call site. Board squares are not Buttons and keep their
      // own move and capture sounds.
      onClick={(event) => {
        playSound("click");
        onClick?.(event);
      }}
      {...props}
    />
  );
}

export { buttonVariants };
