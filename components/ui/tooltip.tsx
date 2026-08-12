"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

export function TooltipProvider({
  delayDuration = 400,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * Every icon-only control gets one of these, because nothing on this page carries a text
 * label. Copy stays short and reads "Action (Shortcut)" or "Label, brief description".
 */
export function Tooltip({ label, children, side = "top" }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            "tooltip-content z-50 rounded-md px-2 py-1 text-xs",
            "bg-[var(--ink)] text-[var(--surface)]",
          )}
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
