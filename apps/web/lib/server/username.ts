import { prisma } from "@/lib/prisma";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;

/**
 * Lowercase and strip to a valid slug — the same shape `availableUsername`
 * produces, because a username picked by hand and one derived from a provider
 * have to live in the same namespace and the same URLs.
 */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, USERNAME_MAX);
}

/**
 * Why a normalized username is not acceptable, or null if it is. Used by the
 * one place a user picks their own — everything else derives a guaranteed-valid
 * one through `availableUsername`.
 */
export function usernameError(name: string): string | null {
  if (name.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `Username must be ${USERNAME_MAX} characters or fewer.`;
  if (!/^[a-z0-9_]+$/.test(name)) return "Use lowercase letters, numbers and underscores only.";
  return null;
}

/**
 * A free FOBS username, derived from a preferred one.
 *
 * Three callers need this — the X callback, the Google callback and wallet
 * sign-in — and they all need the same answer, so it lives in one place. The
 * rules are:
 *
 *   - **Collisions are resolved, not rejected.** An X handle, a Google name and
 *     a wallet-derived stub all draw from the same namespace, and a name being
 *     taken is not the user's fault. Failing the sign-in over it would be a dead
 *     end with no way forward.
 *
 *   - **The result is a valid slug**, lowercased and stripped to `[a-z0-9_]`,
 *     because usernames appear in URLs.
 *
 *   - **It terminates.** Fifty numbered attempts, then a random suffix. The
 *     random branch is effectively unreachable, but it exists so this function
 *     cannot return `undefined` on a path that creates an account.
 */
export async function availableUsername(preferred: string): Promise<string> {
  const base =
    preferred
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 24) || "user";

  // One query for every candidate that could be taken, rather than fifty
  // round trips for the common case where the base name is free.
  const candidates = [base];
  for (let suffix = 2; suffix <= 50; suffix++) candidates.push(`${base}-${suffix}`);

  const taken = await prisma.user.findMany({
    where: { username: { in: candidates } },
    select: { username: true }
  });
  const used = new Set(taken.map((row) => row.username));

  const free = candidates.find((candidate) => !used.has(candidate));
  if (free) return free;

  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
