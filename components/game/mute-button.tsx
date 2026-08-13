"use client";

import { Volume2Icon, VolumeXIcon } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";

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
        {muted ? (
          <VolumeXIcon className="size-[18px]" aria-hidden="true" />
        ) : (
          <Volume2Icon className="size-[18px]" aria-hidden="true" />
        )}
      </Button>
    </Tooltip>
  );
}
