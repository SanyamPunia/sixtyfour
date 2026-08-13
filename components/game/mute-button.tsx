"use client";

import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { cn } from "@/lib/utils.ts";

interface MuteButtonProps {
  muted: boolean;
  onToggle: () => void;
}

export function MuteButton({ muted, onToggle }: MuteButtonProps) {
  return (
    <Tooltip label={muted ? "Unmute" : "Mute"}>
      <Button
        aria-label={muted ? "Unmute the game" : "Mute the game"}
        aria-pressed={muted}
        onClick={onToggle}
      >
        {/* Stacked rather than swapped, so the change animates. A conditional render
            remounts the icon and there is nothing to transition between. */}
        <span className="swap-icons size-[18px]">
          <VolumeXIcon
            className={cn("size-[18px]", !muted && "swap-out-a")}
            aria-hidden="true"
          />
          <Volume2Icon
            className={cn("size-[18px]", muted && "swap-out-b")}
            aria-hidden="true"
          />
        </span>
      </Button>
    </Tooltip>
  );
}
