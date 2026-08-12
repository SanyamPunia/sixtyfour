"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { squirclePath } from "@/lib/squircle.ts";
import { cn } from "@/lib/utils.ts";

interface SmoothCornersProps {
  radius: number;
  smoothing?: number;
  className?: string;
  children: ReactNode;
}

/**
 * Clips its children to a continuous-corner shape.
 *
 * The path depends on the measured size, so there is one frame before it exists. A plain
 * `border-radius` covers that frame, which keeps the corners from popping square to round
 * on load. `data-state` is there so the behaviour is visible in the DOM when debugging.
 */
export function SmoothCorners({
  radius,
  smoothing = 0.6,
  className,
  children,
}: SmoothCornersProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setPath(squirclePath({ width, height, radius, smoothing }));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [radius, smoothing]);

  return (
    <div
      ref={ref}
      data-state={path === null ? "measuring" : "ready"}
      className={cn(className, path === null && "rounded-xl")}
      style={path === null ? undefined : { clipPath: `path("${path}")` }}
    >
      {children}
    </div>
  );
}
