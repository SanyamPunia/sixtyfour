"use client";

import { CameraIcon, CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { TextMorph } from "@/components/ui/text-morph.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import type { GameState } from "@/lib/game/reducer.ts";
import { matedKingSquare, resultLabel } from "@/lib/game/reducer.ts";
import { cardFilename } from "@/lib/share/card.ts";
import {
  canCopyImages,
  copyImage,
  downloadImage,
  readCardColors,
  renderCard,
} from "@/lib/share/render.ts";
import { cn } from "@/lib/utils.ts";

interface ShareButtonProps {
  state: GameState;
  flipped: boolean;
}

/**
 * Takes a picture of the finished board.
 *
 * Only exists once a game is over, because that is the only moment there is anything to
 * show. It renders on opening rather than on pressing an action, so what you are about to
 * send is on screen before you decide to send it.
 *
 * Two ways out: onto the clipboard, or into a file. Copying is the one people actually
 * want, since it goes straight into a message, but it is unsupported in some browsers and
 * blocked in others, so the download is always there.
 */
export function ShareButton({ state, flipped }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const result = resultLabel(state);

  const release = useCallback(() => {
    if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      release();
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    };
  }, [release]);

  useEffect(() => {
    if (!open || result === null) return;
    let cancelled = false;
    setProblem(null);
    // Cleared before drawing, so the dialog never shows the previous card while the new one
    // is still being made. That stale frame is what a re-open after a theme change or a
    // rematch would otherwise show, and it looks like the feature simply ignored both.
    setPreview(null);

    void (async () => {
      try {
        const blob = await renderCard({
          position: state.position,
          flipped,
          lastMove: state.lastMove,
          matedKing: matedKingSquare(state),
          colors: readCardColors(),
          result,
          humanColor: state.humanColor,
          moveCount: state.history.length,
        });
        if (cancelled) return;
        blobRef.current = blob;
        release();
        urlRef.current = URL.createObjectURL(blob);
        setPreview(urlRef.current);
      } catch {
        if (!cancelled) setProblem("The image could not be drawn.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, result, state, flipped, release]);

  const onCopy = async (): Promise<void> => {
    const blob = blobRef.current;
    if (blob === null) return;
    try {
      await copyImage(blob);
      setCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setProblem("This browser would not take the image. Download it instead.");
    }
  };

  if (result === null) return null;

  return (
    <>
      {/*
        The gradient itself, defined once and referenced by the stroke.
        Zero-sized and hidden, because it is a definition rather than a drawing.
      */}
      <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
        <title>Share accent</title>
        <defs>
          <linearGradient id="share-accent" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--share-from)" />
            <stop offset="100%" stopColor="var(--share-to)" />
          </linearGradient>
        </defs>
      </svg>

      <Tooltip label="Share this game">
        <Button aria-label="Share this game" aria-expanded={open} onClick={() => setOpen(true)}>
          <CameraIcon className="share-icon size-[18px]" aria-hidden="true" />
        </Button>
      </Tooltip>

      <Dialog.Root open={open} onOpenChange={setOpen}>
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
            <Dialog.Title className="text-sm font-semibold">Share this game</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-sm text-[var(--ink-soft)]">
              The final position, as a picture.
            </Dialog.Description>

            {/*
              Backed in a different tone from the dialog. The card's own background is the
              surface colour, so on the surface it has no edge and reads as a board floating
              in the dialog rather than as the picture that is about to be sent.
            */}
            <div className="mt-5 overflow-hidden rounded-xl bg-[var(--board-dark)] p-3 ring-1 ring-[var(--board-dark)]">
              {preview === null ? (
                // Shaped like the image that is arriving, rather than a word saying so.
                <div className="aspect-[1080/1160] w-full animate-pulse rounded-lg bg-[var(--surface)]" />
              ) : (
                <img
                  src={preview}
                  alt={`The final position, ${result}`}
                  className="block w-full rounded-lg select-none"
                  draggable={false}
                />
              )}
            </div>

            <div className="mt-5 flex items-center gap-2 border-t border-[var(--board-dark)] pt-4">
              {canCopyImages() ? (
                <Button
                  variant="quiet"
                  size="dialog"
                  className="flex-1"
                  disabled={preview === null}
                  onClick={() => void onCopy()}
                >
                  <span className="swap-icons size-4 shrink-0">
                    <CopyIcon
                      className={cn("size-4", copied && "swap-out-a")}
                      aria-hidden="true"
                    />
                    <CheckIcon
                      className={cn("size-4", !copied && "swap-out-b")}
                      aria-hidden="true"
                    />
                  </span>
                  <TextMorph>{copied ? "Copied" : "Copy image"}</TextMorph>
                </Button>
              ) : null}
              <Button
                variant="quiet"
                size="dialog"
                className="flex-1"
                disabled={preview === null}
                onClick={() => {
                  const blob = blobRef.current;
                  if (blob !== null) downloadImage(blob, cardFilename(result));
                }}
              >
                <DownloadIcon className="size-4 shrink-0" aria-hidden="true" />
                Download
              </Button>
            </div>

            {problem === null ? null : (
              <p role="alert" className="mt-4 text-sm" style={{ color: "var(--danger)" }}>
                {problem}
              </p>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
