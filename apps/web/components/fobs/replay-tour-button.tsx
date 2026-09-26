"use client";

// components/fobs/replay-tour-button.tsx
//
// Reopens the first-run walkthrough on demand. The tour itself is always mounted
// in the signed-in layout and listens for a window event, so this button only
// has to fire it — no shared state, no URL param, works from any route.

import { replayWalkthrough } from "@/components/fobs/walkthrough";

export function ReplayTourButton() {
  return (
    <button
      type="button"
      className="fobs-button-secondary"
      onClick={() => replayWalkthrough()}
    >
      Replay walkthrough
    </button>
  );
}
