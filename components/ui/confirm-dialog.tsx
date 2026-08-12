"use client";

import { AlertDialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils.ts";
import { Button } from "./button.tsx";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  trigger?: ReactNode;
}

/**
 * Acts first, closes after.
 *
 * A raw `AlertDialog.Action` is a close button: it dismisses before the handler has
 * finished, which makes a dialog that visually closes while its work is still running.
 * The action here is a plain button, and the dialog is closed by the caller once the work
 * has actually happened.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending = false,
  onConfirm,
  trigger,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        // Dismissal is blocked while the action runs, so the dialog cannot close out from
        // under its own mutation.
        if (!pending) onOpenChange(next);
      }}
    >
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/40 dark:bg-black/60" />
        <AlertDialog.Content
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          className={cn(
            "dialog-content fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm",
            "-translate-x-1/2 -translate-y-1/2",
            "max-h-[calc(100svh-4rem)] overflow-y-auto rounded-2xl p-5",
            "bg-[var(--surface)] text-[var(--ink)] ring-1 ring-[var(--board-dark)]",
          )}
        >
          <AlertDialog.Title className="text-sm font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-sm text-[var(--ink-soft)]">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2 border-t border-[var(--board-dark)] pt-4">
            <AlertDialog.Cancel asChild>
              <Button variant="quiet" size="dialog" disabled={pending}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant="danger"
              size="dialog"
              disabled={pending}
              onClick={onConfirm}
              autoFocus
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
