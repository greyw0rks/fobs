"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";

/**
 * Pick your own username.
 *
 * A provider seeds one on first sign-in — an X handle, an email's local part —
 * but that is a default, not a decision. This is where the account owner changes
 * it. The username lives in URLs, so the input mirrors the server's slug rules
 * as you type (lowercase, `[a-z0-9_]`) rather than letting you submit something
 * that will only be rejected.
 */
export function UsernameForm({ current }: { current: string }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const changed = value !== current && value.length > 0;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const { username } = await api.updateUsername(value);
      setValue(username);
      setMessage({ tone: "ok", text: `Saved — you are @${username}.` });
      // The username shows in the page header and every profile URL, so re-read
      // the server components rather than patching one label by hand.
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "err",
        text: error instanceof ApiError ? error.message : "Could not save that username."
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fobs-surface p-6">
      <h3 className="text-sm font-semibold">Username</h3>
      <p className="mt-1 text-xs text-[#777872]">
        This is your handle on FOBS — <strong>@{current}</strong> — and it is what
        appears on your profile and in the feed. Lowercase letters, numbers and
        underscores.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <span className="font-mono text-sm text-[#777872]">@</span>
        <input
          className="h-11 flex-1 rounded-lg border border-[#deddd7] bg-white px-3 text-sm outline-none focus:border-[#c9c8c1]"
          value={value}
          maxLength={24}
          disabled={busy}
          onChange={(event) =>
            // Normalize as they type so what they see is what will be saved.
            setValue(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
          }
          aria-label="Username"
        />
        <button className="fobs-button-primary" onClick={save} disabled={!changed || busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {message ? (
        <p
          className={
            message.tone === "err"
              ? "mt-3 text-xs text-[#c94c4c]"
              : "mt-3 text-xs text-[#777872]"
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
