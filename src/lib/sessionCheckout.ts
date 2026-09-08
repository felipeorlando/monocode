import { basename, type GitWorktreeEntry, type GitWorktreeList } from "./fs";

/**
 * Where a session runs inside its repository.
 *
 * Sessions keep the repository root in `cwd` and pin a linked worktree in
 * `worktreeCwd`; the main checkout is simply the absence of a pin. The choice
 * is made once, explicitly, when the session is created — an earlier version of
 * MonoCode moved sessions into worktrees implicitly from the branch picker and
 * that surprise is exactly what this avoids.
 */
export type SessionCheckout =
  | { kind: "main" }
  | { kind: "worktree"; path: string };

type CheckoutSession = {
  cwd: string;
  branch?: string;
  worktreeCwd?: string;
  providerSessionId?: string;
};

export type CheckoutRow =
  | { kind: "checkout"; entry: GitWorktreeEntry }
  | { kind: "create"; branch: string };

/** Checkout a session is bound to right now. */
export function sessionCheckout(session: CheckoutSession): SessionCheckout {
  return session.worktreeCwd
    ? { kind: "worktree", path: session.worktreeCwd }
    : { kind: "main" };
}

/** True when this working tree is the one the session already runs in. */
export function isSessionCheckout(
  session: CheckoutSession,
  entry: GitWorktreeEntry,
): boolean {
  return session.worktreeCwd ? entry.path === session.worktreeCwd : entry.main;
}

/**
 * Bind a session to a checkout.
 *
 * Only `worktreeCwd` moves. `cwd` stays the repository the session belongs to,
 * so the project rail, recents, and session history keep grouping it with its
 * siblings whichever tree it runs in. A provider conversation is rooted in the
 * directory it started in, so its id is dropped whenever that directory
 * changes and the next turn opens a fresh one.
 */
export function applySessionCheckout<T extends CheckoutSession>(
  session: T,
  checkout: SessionCheckout,
): T {
  const worktreeCwd = checkout.kind === "worktree" ? checkout.path : undefined;
  if ((session.worktreeCwd || undefined) === worktreeCwd) return session;
  return {
    ...session,
    worktreeCwd,
    // Leftover pin from the removed session-branch feature; never carry it into
    // a checkout it was never about.
    branch: undefined,
    providerSessionId: undefined,
  };
}

/** Row title: the main checkout, else the branch, else the folder name. */
export function checkoutLabel(entry: GitWorktreeEntry): string {
  if (entry.main) return "Main checkout";
  return entry.branch || basename(entry.path);
}

/** Everything a picker query is matched against for one working tree. */
export function checkoutSearchText(entry: GitWorktreeEntry): string {
  return `${checkoutLabel(entry)} ${entry.branch ?? ""} ${entry.path}`;
}

/**
 * Picker rows for `query`: a create row when the query names something new,
 * then every working tree that matches.
 *
 * `branches` are the repository's local branch names. Creating reuses the query
 * as a branch name, so the row is withheld when a branch already owns it rather
 * than letting the user walk into a git error.
 */
export function checkoutRows(
  list: GitWorktreeList | null,
  query: string,
  branches: readonly string[] = [],
): CheckoutRow[] {
  const entries = selectableWorktrees(list);
  const name = query.trim();
  const needle = name.toLowerCase();
  const matches = needle
    ? entries.filter((entry) =>
        checkoutSearchText(entry).toLowerCase().includes(needle),
      )
    : entries;
  const taken =
    branches.includes(name) || entries.some((entry) => entry.branch === name);
  const create: CheckoutRow[] =
    name && !taken ? [{ kind: "create", branch: name }] : [];
  return [
    ...create,
    ...matches.map((entry): CheckoutRow => ({ kind: "checkout", entry })),
  ];
}

/**
 * Working trees a session can actually start in. A prunable entry is registered
 * but its folder is gone, so offering it would only produce a failing spawn.
 */
export function selectableWorktrees(
  list: GitWorktreeList | null,
): GitWorktreeEntry[] {
  return (list?.entries ?? []).filter((entry) => !entry.prunable);
}

/**
 * Start point a new worktree defaults to: the branch the main checkout is on.
 * Empty when the repository has no main entry or is detached, in which case the
 * backend falls back to HEAD.
 */
export function defaultStartRef(list: GitWorktreeList | null): string {
  return list?.entries.find((entry) => entry.main)?.branch ?? "";
}
