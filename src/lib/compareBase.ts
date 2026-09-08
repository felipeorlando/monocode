import { projectKey } from "./paths";

const KEY = "monocode.compareBase.v1";

/**
 * The base ref each folder compares its branch against. Keyed by the full path
 * (see `projectKey`), so a worktree keeps its own base instead of inheriting
 * the one picked in the main checkout it was branched from.
 */
type Stored = Record<string, string>;

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Stored = {};
    for (const [key, value] of Object.entries(parsed as Stored)) {
      if (typeof value === "string" && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function write(stored: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // private mode / quota
  }
}

/** The saved base for a folder, or `null` to mean "repository default". */
export function loadCompareBase(cwd: string): string | null {
  if (!cwd || cwd === "~") return null;
  return read()[projectKey(cwd)] ?? null;
}

/** Saving `null` clears the pick, putting the folder back on the default. */
export function saveCompareBase(cwd: string, base: string | null): void {
  if (!cwd || cwd === "~") return;
  const key = projectKey(cwd);
  const stored = read();
  const next = base?.trim();
  if (!next) {
    if (!(key in stored)) return;
    delete stored[key];
  } else {
    if (stored[key] === next) return;
    stored[key] = next;
  }
  write(stored);
}

/**
 * The ref name sent to the backend for a branch row. Remote-only branches are
 * qualified so a name that exists on several remotes cannot resolve to the
 * wrong one.
 */
export function compareBaseRefName(branch: {
  name: string;
  remote: string | null;
}): string {
  return branch.remote ? `${branch.remote}/${branch.name}` : branch.name;
}
