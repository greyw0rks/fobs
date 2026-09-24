// lib/profile-links.ts
//
// The profile "links" column is a JSON-encoded array of { label, url } stored as
// text (see the `links` field on the User model). The shape is validated here —
// in the app, before it is written — rather than by the database, so the same
// rules apply on the sqlite dev schema and the postgres prod schema.
//
// Two entry points, used on both sides of the wire:
//   parseProfileLinks  — read a stored string back into a typed, safe array
//   sanitizeProfileLinks — validate untrusted input before it is written
//
// A link only ever renders if its URL is an absolute http(s) URL, so a stored
// value can never become a `javascript:` href or a relative path that resolves
// against our own origin.

import type { ProfileLink } from "@/lib/types";

/** Hard caps, enforced on write and defensively on read. */
export const MAX_LINKS = 5;
export const MAX_LABEL = 40;
export const MAX_URL = 200;
export const MAX_BIO = 160;

/** True only for an absolute http(s) URL. */
export function isValidLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Read the stored column back into a typed array. Anything malformed — bad JSON,
 * a non-array, entries missing fields, a URL that is not http(s) — is dropped
 * rather than thrown, so one bad row never breaks a profile render.
 */
export function parseProfileLinks(stored: string | null | undefined): ProfileLink[] {
  if (!stored) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: ProfileLink[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_LINKS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const label = (entry as Record<string, unknown>).label;
    const url = (entry as Record<string, unknown>).url;
    if (typeof label !== "string" || typeof url !== "string") continue;
    const trimmedLabel = label.trim().slice(0, MAX_LABEL);
    const trimmedUrl = url.trim();
    if (!trimmedLabel || !isValidLinkUrl(trimmedUrl) || trimmedUrl.length > MAX_URL) continue;
    out.push({ label: trimmedLabel, url: trimmedUrl });
  }
  return out;
}

/**
 * Validate untrusted input from the edit form. Returns the cleaned links, or an
 * error message naming the first problem. Empty input is valid and clears the
 * list. The returned array is what should be `JSON.stringify`d into the column.
 */
export function sanitizeProfileLinks(
  input: unknown
): { links: ProfileLink[] } | { error: string } {
  if (input == null) return { links: [] };
  if (!Array.isArray(input)) return { error: "Links must be a list." };
  if (input.length > MAX_LINKS) return { error: `At most ${MAX_LINKS} links.` };

  const out: ProfileLink[] = [];
  for (const entry of input) {
    if (typeof entry !== "object" || entry === null) {
      return { error: "Each link needs a label and a URL." };
    }
    const label = (entry as Record<string, unknown>).label;
    const url = (entry as Record<string, unknown>).url;
    const trimmedLabel = typeof label === "string" ? label.trim() : "";
    const trimmedUrl = typeof url === "string" ? url.trim() : "";
    // A wholly-empty row is silently dropped so the form can carry blank slots.
    if (!trimmedLabel && !trimmedUrl) continue;
    if (!trimmedLabel) return { error: "Every link needs a label." };
    if (trimmedLabel.length > MAX_LABEL) return { error: `Labels are ${MAX_LABEL} characters or fewer.` };
    if (!isValidLinkUrl(trimmedUrl)) return { error: `"${trimmedLabel}" needs a valid http(s) URL.` };
    if (trimmedUrl.length > MAX_URL) return { error: `URLs are ${MAX_URL} characters or fewer.` };
    out.push({ label: trimmedLabel, url: trimmedUrl });
  }
  return { links: out };
}

/** Validate and trim a bio. Empty is valid and clears it (stored as null). */
export function sanitizeBio(input: unknown): { bio: string | null } | { error: string } {
  if (input == null) return { bio: null };
  if (typeof input !== "string") return { error: "Bio must be text." };
  const trimmed = input.trim();
  if (!trimmed) return { bio: null };
  if (trimmed.length > MAX_BIO) return { error: `Bio is ${MAX_BIO} characters or fewer.` };
  return { bio: trimmed };
}
