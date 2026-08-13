"use client";

import { CheckIcon, CopyIcon, LinkIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { isValidKey, KEY_LENGTH, normalizeKey } from "@/lib/room/key.ts";
import { cn } from "@/lib/utils.ts";
import { PresenceDot, presenceWords } from "./presence-dot.tsx";
import type { RoomControls, RoomView } from "./use-room.ts";

interface RoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: RoomView;
  controls: RoomControls;
}

const CONNECTING: Record<string, string> = {
  connecting: "Opening the room",
  reconnecting: "Reconnecting",
};

/**
 * Making a room, or getting into one.
 *
 * Two ways in, and they are not the same shape, so they are not presented as one form with
 * a mode switch. Creating is a single press. Joining needs six characters typed correctly,
 * which is a different job with a different failure.
 *
 * Once you are in, the dialog stops being a form and becomes the thing you show someone: a
 * key large enough to read out loud and a link to send.
 */
export function RoomDialog({ open, onOpenChange, room, controls }: RoomDialogProps) {
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState<"link" | "key" | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inside = room.key !== null;
  const busy = room.status === "connecting" || room.status === "reconnecting";

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    };
  }, []);

  const copy = async (what: "link" | "key", value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard access is refused in some contexts. The key is on screen and can be
      // read, so there is nothing worth interrupting the player over.
    }
  };

  const submitJoin = (): void => {
    if (!isValidKey(typed)) return;
    controls.join(normalizeKey(typed));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/40 dark:bg-black/60" />
        <Dialog.Content
          className={cn(
            "dialog-content fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm",
            "-translate-x-1/2 -translate-y-1/2",
            "max-h-[calc(100svh-4rem)] overflow-y-auto rounded-2xl p-5",
            "bg-[var(--surface)] text-[var(--ink)] ring-1 ring-[var(--board-dark)]",
          )}
        >
          <Dialog.Title className="text-sm font-semibold">
            {inside ? "Your room" : "Play a friend"}
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm text-[var(--ink-soft)]">
            {inside
              ? "Send the link, or read out the key."
              : "Open a room and share the key, or type one you were given."}
          </Dialog.Description>

          {inside ? (
            <div className="mt-5 flex flex-col gap-4">
              <div className="flex flex-col items-center gap-2 rounded-xl bg-[var(--board-dark)] px-4 py-5">
                <span className="text-xs text-[var(--ink-soft)]">Room key</span>
                <span
                  data-room-key={room.key}
                  data-room-seat={room.seat ?? ""}
                  data-room-opponent={room.opponent}
                  className="font-mono text-2xl tracking-[0.35em] tabular-nums"
                >
                  {room.key}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="quiet"
                  size="dialog"
                  className="flex-1"
                  disabled={room.link === null}
                  onClick={() => void copy("link", room.link ?? "")}
                >
                  {copied === "link" ? (
                    <CheckIcon className="size-4" aria-hidden="true" />
                  ) : (
                    <LinkIcon className="size-4" aria-hidden="true" />
                  )}
                  {copied === "link" ? "Copied" : "Copy link"}
                </Button>
                <Button
                  variant="quiet"
                  size="dialog"
                  className="flex-1"
                  onClick={() => void copy("key", room.key ?? "")}
                >
                  {copied === "key" ? (
                    <CheckIcon className="size-4" aria-hidden="true" />
                  ) : (
                    <CopyIcon className="size-4" aria-hidden="true" />
                  )}
                  {copied === "key" ? "Copied" : "Copy key"}
                </Button>
              </div>

              <div className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
                <PresenceDot presence={room.opponent} />
                <span>{presenceWords(room.opponent)}</span>
                <span className="ml-auto text-xs">
                  You are {room.seat === null ? "seated" : room.seat}
                </span>
              </div>

              <div className="flex justify-end border-t border-[var(--board-dark)] pt-4">
                <Button
                  variant="quiet"
                  size="dialog"
                  onClick={() => {
                    controls.leave();
                    onOpenChange(false);
                  }}
                >
                  Leave room
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-4">
              <Button
                variant="quiet"
                size="dialog"
                className="w-full"
                disabled={busy}
                onClick={() => controls.create("random")}
              >
                {busy && typed === "" ? CONNECTING[room.status] : "Create a room"}
              </Button>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-[var(--board-dark)]" />
                <span className="text-xs text-[var(--ink-soft)]">or</span>
                <span className="h-px flex-1 bg-[var(--board-dark)]" />
              </div>

              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitJoin();
                }}
              >
                <input
                  value={typed}
                  onChange={(event) => setTyped(normalizeKey(event.target.value))}
                  maxLength={KEY_LENGTH}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-label="Room key"
                  placeholder="Room key"
                  className={cn(
                    "h-10 min-w-0 flex-1 rounded-full px-4 text-sm placeholder:text-sm",
                    "bg-[var(--board-dark)] text-[var(--ink)] placeholder:text-[var(--ink-soft)]",
                    "font-mono tracking-[0.2em] uppercase",
                    "outline-none transition-all duration-200",
                    "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]",
                  )}
                />
                <Button
                  type="submit"
                  variant="quiet"
                  size="dialog"
                  disabled={!isValidKey(typed) || busy}
                >
                  Join
                </Button>
              </form>
            </div>
          )}

          {room.problem === null ? null : (
            <p role="alert" className="mt-4 text-sm" style={{ color: "var(--danger)" }}>
              {room.problem}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
