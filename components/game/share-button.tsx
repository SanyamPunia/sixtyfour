"use client";

import { CameraIcon, CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { TextMorph } from "@/components/ui/text-morph.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import type { GameState } from "@/lib/game/reducer.ts";
import { matedKingSquare, resultLabel } from "@/lib/game/reducer.ts";
import { CARD_HEIGHT, CARD_WIDTH, cardFilename } from "@/lib/share/card.ts";
import { CARD_BACKGROUNDS, DEFAULT_BACKGROUND } from "@/lib/share/palette.ts";
import {
  backgroundSwatch,
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
  // Kept for as long as the dialog is mounted, so trying a few and going back to the first
  // does not fight you. It deliberately does not persist: it belongs to this picture.
  const [background, setBackground] = useState(DEFAULT_BACKGROUND);
  /*
   * The theme, watched rather than read once.
   *
   * The picture takes its colours from the tokens when it draws, so a theme toggle changes
   * what it should look like. Nothing in React re-renders on an attribute changing on the
   * root element, so without this the card silently keeps the colours of whichever theme
   * was current when the game ended.
   */
  const [theme, setTheme] = useState("");

  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme ?? "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What the picture currently on screen was drawn from, so it is not drawn again. */
  const signatureRef = useRef<string | null>(null);
  const gameRef = useRef<string | null>(null);

  const result = resultLabel(state);
  const [swatches, setSwatches] = useState<Record<string, string>>({});

  /*
   * The fills are read out of the document rather than passed in, so the theme is a real
   * input here even though nothing in the body mentions it. The first swatch follows the
   * interface and has to move when it does.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: theme changes what is read
  useEffect(() => {
    if (result === null) return;
    // Read in an effect rather than while rendering. There is no computed style on the
    // server, and the tokens change under a theme toggle while the page is alive.
    const next: Record<string, string> = {};
    for (const option of CARD_BACKGROUNDS) next[option.id] = backgroundSwatch(option.id);
    setSwatches(next);
  }, [result, theme]);

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

  /*
   * Drawn once per distinct picture, and shown only when it can actually paint.
   *
   * Three things were going wrong at once. Clearing the preview on close emptied the dialog
   * while it was still animating shut, so the picture vanished and then the box collapsed
   * after it. Re-opening redrew a picture that had not changed, for no reason. And setting
   * the source before the bitmap was decoded gave a frame of empty box between the skeleton
   * and the image, which read as a third state.
   *
   * So the picture is prepared as soon as a game has a result, not when the dialog opens.
   * By the time anyone reaches the button it is already drawn and decoded, so opening shows
   * it, closing keeps it, and changing the background swaps it in place. There is no state
   * between those to see.
   */
  useEffect(() => {
    if (result === null) return;

    const game = `${result}|${state.history.length}|${state.position.hash}|${flipped}`;
    const signature = `${game}|${background}|${theme}`;
    if (signature === signatureRef.current && urlRef.current !== null) return;

    // Only a different game invalidates what is already up. A background or a theme is a
    // redraw of the same picture, and holding the old one until the new one lands is what
    // keeps the switch from flashing.
    if (gameRef.current !== null && gameRef.current !== game) setPreview(null);
    gameRef.current = game;

    let cancelled = false;
    setProblem(null);

    void (async () => {
      try {
        const blob = await renderCard({
          position: state.position,
          flipped,
          lastMove: state.lastMove,
          matedKing: matedKingSquare(state),
          colors: readCardColors(background),
          result,
          humanColor: state.humanColor,
          moveCount: state.history.length,
        });
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        // Decoded here rather than by the browser after React mounts the element, so the
        // picture is painted on the frame it appears on instead of one after it.
        const decoded = new Image();
        decoded.src = url;
        await decoded.decode().catch(() => {});
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }

        blobRef.current = blob;
        release();
        urlRef.current = url;
        signatureRef.current = signature;
        setPreview(url);
      } catch {
        if (!cancelled) setProblem("The image could not be drawn.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [result, state, flipped, background, theme, release]);

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
              One hairline and nothing else.

              This briefly had a padded backing in a different tone, to give the card an
              edge against a dialog painted the same surface colour. In dark that tone is
              lighter than the card itself, so it read as a frame around a frame. A single
              ring separates them without drawing a second box.
            */}
            <div className="mt-5 overflow-hidden rounded-xl ring-1 ring-[var(--board-dark)]">
              {preview === null ? (
                // Shaped like the image that is arriving, rather than a word saying so.
                // The ratio is inline: it holds the dialog's height open before there is
                // anything to measure, so it must not depend on a class being generated.
                <div
                  className="w-full animate-pulse bg-[var(--board-dark)]"
                  style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }}
                />
              ) : (
                <img
                  src={preview}
                  alt={`The final position, ${result}`}
                  className="block w-full select-none"
                  draggable={false}
                />
              )}
            </div>

            {/*
              The backgrounds, under the picture they change.

              Placed here rather than beside the actions, because choosing one is part of
              looking at the picture and not part of sending it. The row is short on
              purpose: a long one turns two presses into a decision.
            */}
            <fieldset className="mt-4 flex items-center justify-center gap-2">
              <legend className="sr-only">Picture background</legend>
              {CARD_BACKGROUNDS.map((option) => {
                const selected = option.id === background;
                return (
                  <Tooltip key={option.id} label={option.label}>
                    {/*
                      A real radio, restyled, rather than a button wearing the role. Same
                      name means the browser gives the group its arrow-key behaviour and its
                      announcement for free, and native controls carry their own press
                      state.
                    */}
                    <input
                      type="radio"
                      name="card-background"
                      value={option.id}
                      checked={selected}
                      onChange={() => setBackground(option.id)}
                      aria-label={option.label}
                      className={cn(
                        "size-7 cursor-pointer appearance-none rounded-full transition-all duration-200",
                        "outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]",
                        // The ring is the only thing marking the choice, and a swatch can be
                        // almost the same colour as the dialog behind it. The offset is what
                        // keeps the two apart.
                        selected
                          ? "ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--surface)]"
                          : "ring-1 ring-[var(--board-dark)] hover:ring-[var(--ink-soft)]",
                      )}
                      style={{ background: swatches[option.id] ?? "transparent" }}
                    />
                  </Tooltip>
                );
              })}
            </fieldset>

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
