"use client";

import { UsersIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { PresenceDot } from "./presence-dot.tsx";
import { RoomDialog } from "./room-dialog.tsx";
import type { RoomControls, RoomView } from "./use-room.ts";

interface RoomButtonProps {
  room: RoomView;
  controls: RoomControls;
  /** Whether the game can still be given up. */
  live: boolean;
}

/**
 * Opens the room dialog, and says at a glance whether anyone is on the other side.
 *
 * The dot rides on the button rather than sitting next to it, because the two are one
 * statement: this is the room control, and this is what the room currently amounts to.
 * There is no dot outside a room, so the control looks like every other one until it has
 * something to report.
 */
export function RoomButton({ room, controls, live }: RoomButtonProps) {
  const [open, setOpen] = useState(false);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const inside = room.key !== null;

  return (
    <>
      <Tooltip label={inside ? `Room ${room.key}` : "Play with a friend"}>
        <Button
          aria-label={inside ? `Room ${room.key}` : "Play with a friend"}
          aria-expanded={open}
          className="relative"
          onClick={() => setOpen(true)}
        >
          <UsersIcon className="size-[18px]" aria-hidden="true" />
          {inside ? (
            // Pinned to the corner and ringed in the page surface, so it reads as attached
            // to the control rather than as something drawn on top of the icon.
            <span className="absolute top-1.5 right-1.5 rounded-full ring-2 ring-[var(--surface)]">
              <PresenceDot presence={room.opponent} />
            </span>
          ) : null}
        </Button>
      </Tooltip>
      {/*
        Rendered here beside the trigger rather than inside it, and mounted whether or not
        it is open, so closing the dialog cannot unmount the thing that owns its state.
      */}
      <RoomDialog
        open={open}
        onOpenChange={setOpen}
        room={room}
        controls={controls}
        live={live}
        onResign={() => {
          // The room dialog closes first. Two stacked dialogs trap focus in the wrong one,
          // and the confirm has to outlive the thing that asked for it.
          setOpen(false);
          setConfirmingResign(true);
        }}
      />

      {/*
        At this component's root rather than inside the room dialog, which unmounts when it
        closes and would take the confirm with it.
      */}
      <ConfirmDialog
        open={confirmingResign}
        onOpenChange={setConfirmingResign}
        title="Resign this game?"
        description="Your opponent wins immediately. There is no undo, and the only way back to a game is a rematch."
        confirmLabel="Resign"
        onConfirm={() => {
          controls.resign();
          setConfirmingResign(false);
        }}
      />
    </>
  );
}
