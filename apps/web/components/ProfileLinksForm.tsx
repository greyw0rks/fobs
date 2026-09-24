"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { MAX_BIO, MAX_LINKS } from "@/lib/profile-links";
import type { ProfileLink } from "@/lib/types";

/**
 * Edit the profile's bio and external links — shown only on the owner's own
 * profile. The rows mirror what the server stores: a label and an http(s) URL.
 * Validation is duplicated loosely here for a responsive form, but the server is
 * the authority (`/api/me/profile` runs `sanitizeProfileLinks`), so this never
 * has to be exhaustive — a bad row comes back as an error message.
 */
export function ProfileLinksForm({
  initialBio,
  initialLinks
}: {
  initialBio: string | null;
  initialLinks: ProfileLink[];
}) {
  const router = useRouter();
  const [bio, setBio] = useState(initialBio ?? "");
  const [links, setLinks] = useState<ProfileLink[]>(initialLinks);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function setRow(index: number, patch: Partial<ProfileLink>) {
    setLinks((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function addRow() {
    setLinks((rows) => (rows.length >= MAX_LINKS ? rows : [...rows, { label: "", url: "" }]));
  }
  function removeRow(index: number) {
    setLinks((rows) => rows.filter((_, i) => i !== index));
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      // Drop wholly-empty rows before sending; the server does the same.
      const cleaned = links.filter((row) => row.label.trim() || row.url.trim());
      const result = await api.updateProfile({ bio, links: cleaned });
      setBio(result.bio ?? "");
      setLinks(result.links);
      setMessage({ tone: "ok", text: "Saved." });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "err",
        text: error instanceof ApiError ? error.message : "Could not save your profile."
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fobs-surface p-5">
      <h3 className="text-sm font-semibold">Bio &amp; links</h3>
      <p className="mt-1 text-xs text-[#777872]">
        Shown on your profile. Links open in a new tab; only http(s) URLs are kept.
      </p>

      <label className="mt-4 block text-[11px] font-medium uppercase tracking-wide text-[#898a84]">
        Bio
      </label>
      <textarea
        className="mt-1 h-20 w-full resize-none rounded-lg border border-[#deddd7] bg-white px-3 py-2 text-sm outline-none focus:border-[#c9c8c1]"
        value={bio}
        maxLength={MAX_BIO}
        disabled={busy}
        placeholder="A line about you…"
        onChange={(event) => setBio(event.target.value)}
      />
      <p className="mt-1 text-right text-[10px] text-[#a2a39c]">
        {bio.length}/{MAX_BIO}
      </p>

      <div className="mt-3 space-y-2">
        {links.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              className="h-10 w-1/3 rounded-lg border border-[#deddd7] bg-white px-3 text-sm outline-none focus:border-[#c9c8c1]"
              value={row.label}
              maxLength={40}
              disabled={busy}
              placeholder="Label"
              aria-label="Link label"
              onChange={(event) => setRow(index, { label: event.target.value })}
            />
            <input
              className="h-10 flex-1 rounded-lg border border-[#deddd7] bg-white px-3 text-sm outline-none focus:border-[#c9c8c1]"
              value={row.url}
              maxLength={200}
              disabled={busy}
              placeholder="https://…"
              aria-label="Link URL"
              inputMode="url"
              onChange={(event) => setRow(index, { url: event.target.value })}
            />
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-xs text-[#c94c4c] hover:bg-[#f7eeee]"
              disabled={busy}
              onClick={() => removeRow(index)}
              aria-label="Remove link"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {links.length < MAX_LINKS ? (
          <button
            type="button"
            className="fobs-button-secondary"
            disabled={busy}
            onClick={addRow}
          >
            Add link
          </button>
        ) : (
          <span className="text-[11px] text-[#a2a39c]">Up to {MAX_LINKS} links.</span>
        )}
        <button className="fobs-button-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {message ? (
        <p
          className={
            message.tone === "err" ? "mt-3 text-xs text-[#c94c4c]" : "mt-3 text-xs text-[#777872]"
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
