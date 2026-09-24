"use client";

import { useState } from "react";

/**
 * Copy-link and native-share for a shareable trade card.
 *
 * Both act on the current page URL, so whatever is shared points back at the
 * exact card the sharer is looking at. `navigator.share` is progressive: where
 * it is missing (most desktops) the button falls back to copying, so the action
 * never silently does nothing.
 */
export function ShareActions() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = typeof window === "undefined" ? "" : window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — nothing to do but leave the label unchanged */
    }
  }

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "FOBS", url });
        return;
      } catch {
        /* user dismissed the sheet — fall through to copy */
      }
    }
    void copy();
  }

  return (
    <div className="flex items-center gap-2">
      <button className="fobs-button-primary" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </button>
      <button className="fobs-button-secondary" onClick={share}>
        Share
      </button>
    </div>
  );
}
