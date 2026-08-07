import { z } from "zod";

/**
 * Nicknames (spec §2.4): the human-facing address layered on agent_id.
 * Case-insensitive unique, normalized to lowercase, charset
 * ^[a-z0-9][a-z0-9_-]{1,23}$ (2–24 chars). Written with a leading '@' in
 * display and API surfaces; stored without it.
 */
export const NICKNAME_RE = /^[a-z0-9][a-z0-9_-]{1,23}$/;

export const nicknameSchema = z.string().regex(NICKNAME_RE);

export const nicknameStatusSchema = z.enum(["none", "verified", "conflict"]);
export type NicknameStatus = z.infer<typeof nicknameStatusSchema>;

/** Strip an optional leading '@', lowercase, validate. Null when invalid. */
export function normalizeNickname(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  const bare = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return NICKNAME_RE.test(bare) ? bare : null;
}

/**
 * Coerce an arbitrary label (e.g. a project folder name like "philip test") into
 * a valid handle for use as a *default* nickname: lowercase, non-charset runs →
 * '-', trimmed to the charset and 24 chars. Returns null only if nothing usable
 * remains (e.g. a single character). Unlike {@link normalizeNickname} (a strict
 * validator of user input), this is lenient on purpose so every agent can get a
 * reachable @handle out of the box.
 */
export function slugifyNickname(raw: string): string | null {
  const bare = raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_-]+/g, "-") // spaces & other junk → hyphen
    .replace(/-{2,}/g, "-") // collapse repeats
    .replace(/^[-_]+|[-_]+$/g, "") // trim leading/trailing separators
    .slice(0, 24)
    .replace(/[-_]+$/g, ""); // a slice can re-expose a trailing separator
  return NICKNAME_RE.test(bare) ? bare : null;
}

/** Display/API form: 'gio' → '@gio'. */
export function formatNickname(bare: string): string {
  return `@${bare}`;
}
