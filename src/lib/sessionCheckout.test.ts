import { describe, expect, it } from "vitest";
import type { GitWorktreeEntry, GitWorktreeList } from "./fs";
import { newSession, sessionWorkCwd, type Session } from "./session";
import {
  applySessionCheckout,
  checkoutLabel,
  checkoutRows,
  defaultStartRef,
  isSessionCheckout,
  selectableWorktrees,
  sessionCheckout,
} from "./sessionCheckout";

function entry(
  path: string,
  branch: string | null,
  overrides: Partial<GitWorktreeEntry> = {},
): GitWorktreeEntry {
  return {
    path,
    branch,
    main: false,
    prunable: false,
    locked: false,
    ...overrides,
  };
}

const REPO = "/projects/monocode";

const LIST: GitWorktreeList = {
  parent: "/projects/monocode-worktrees",
  entries: [
    entry(REPO, "main", { main: true }),
    entry("/projects/monocode-worktrees/feat-picker", "feat/picker"),
    entry("/projects/monocode-worktrees/gone", "gone", { prunable: true }),
  ],
};

function session(cwd = REPO): Session {
  return newSession("cursor", cwd);
}

describe("sessionCheckout", () => {
  it("reads the main checkout as the absence of a pin", () => {
    expect(sessionCheckout(session())).toEqual({ kind: "main" });
    expect(
      sessionCheckout({ ...session(), worktreeCwd: "/projects/wt" }),
    ).toEqual({ kind: "worktree", path: "/projects/wt" });
  });
});

describe("applySessionCheckout", () => {
  it("pins a worktree without moving the session off its project", () => {
    const bound = applySessionCheckout(session(), {
      kind: "worktree",
      path: "/projects/monocode-worktrees/feat-picker",
    });
    expect(bound.cwd).toBe(REPO);
    expect(bound.worktreeCwd).toBe("/projects/monocode-worktrees/feat-picker");
    expect(sessionWorkCwd(bound)).toBe(
      "/projects/monocode-worktrees/feat-picker",
    );
  });

  it("returns to the main checkout by clearing the pin", () => {
    const pinned = {
      ...session(),
      worktreeCwd: "/projects/monocode-worktrees/feat-picker",
    };
    const bound = applySessionCheckout(pinned, { kind: "main" });
    expect(bound.worktreeCwd).toBeUndefined();
    expect(sessionWorkCwd(bound)).toBe(REPO);
  });

  it("drops the provider conversation when the directory changes", () => {
    const pinned = { ...session(), providerSessionId: "acp-1", branch: "old" };
    const bound = applySessionCheckout(pinned, {
      kind: "worktree",
      path: "/projects/monocode-worktrees/feat-picker",
    });
    expect(bound.providerSessionId).toBeUndefined();
    expect(bound.branch).toBeUndefined();
  });

  it("leaves the session alone when the checkout did not change", () => {
    const pinned = {
      ...session(),
      worktreeCwd: "/projects/wt",
      providerSessionId: "acp-1",
    };
    expect(applySessionCheckout(pinned, sessionCheckout(pinned))).toBe(pinned);
    const main = { ...session(), providerSessionId: "acp-1" };
    expect(applySessionCheckout(main, { kind: "main" })).toBe(main);
  });
});

describe("isSessionCheckout", () => {
  it("marks the main entry for an unpinned session", () => {
    const unpinned = session();
    expect(isSessionCheckout(unpinned, LIST.entries[0]!)).toBe(true);
    expect(isSessionCheckout(unpinned, LIST.entries[1]!)).toBe(false);
  });

  it("marks the pinned path for a worktree session", () => {
    const pinned = {
      ...session(),
      worktreeCwd: "/projects/monocode-worktrees/feat-picker",
    };
    expect(isSessionCheckout(pinned, LIST.entries[0]!)).toBe(false);
    expect(isSessionCheckout(pinned, LIST.entries[1]!)).toBe(true);
  });
});

describe("checkoutRows", () => {
  it("lists the main checkout first and hides prunable worktrees", () => {
    const rows = checkoutRows(LIST, "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ kind: "checkout", entry: LIST.entries[0] });
    expect(rows[1]).toEqual({ kind: "checkout", entry: LIST.entries[1] });
    expect(selectableWorktrees(LIST)).toHaveLength(2);
  });

  it("offers a create row for an unused name, ahead of the matches", () => {
    const rows = checkoutRows(LIST, "feat/next", ["main"]);
    expect(rows[0]).toEqual({ kind: "create", branch: "feat/next" });
    expect(rows).toHaveLength(1);
  });

  it("withholds create when a branch or worktree already owns the name", () => {
    expect(checkoutRows(LIST, "main", ["main"])).toEqual([
      { kind: "checkout", entry: LIST.entries[0] },
    ]);
    expect(checkoutRows(LIST, "feat/picker", ["main"])).toEqual([
      { kind: "checkout", entry: LIST.entries[1] },
    ]);
  });

  it("matches on branch, folder, and the main checkout's label", () => {
    expect(checkoutRows(LIST, "picker", ["main", "feat/picker"])).toEqual([
      // "picker" is free as a branch name, so creating stays on offer next to
      // the tree it partially matches.
      { kind: "create", branch: "picker" },
      { kind: "checkout", entry: LIST.entries[1] },
    ]);
    expect(checkoutRows(LIST, "monocode-worktrees/feat", ["main"])).toEqual([
      { kind: "create", branch: "monocode-worktrees/feat" },
      { kind: "checkout", entry: LIST.entries[1] },
    ]);
    expect(checkoutRows(LIST, "Main checkout", ["main"])).toEqual([
      { kind: "create", branch: "Main checkout" },
      { kind: "checkout", entry: LIST.entries[0] },
    ]);
  });

  it("has no rows at all outside a repository", () => {
    expect(checkoutRows(null, "")).toEqual([]);
    expect(checkoutRows(null, "feature")).toEqual([
      { kind: "create", branch: "feature" },
    ]);
  });
});

describe("checkoutLabel", () => {
  it("names the main checkout, the branch, then the folder", () => {
    expect(checkoutLabel(LIST.entries[0]!)).toBe("Main checkout");
    expect(checkoutLabel(LIST.entries[1]!)).toBe("feat/picker");
    expect(checkoutLabel(entry("/projects/wt/detached", null))).toBe("detached");
  });
});

describe("defaultStartRef", () => {
  it("starts new worktrees from the main checkout's branch", () => {
    expect(defaultStartRef(LIST)).toBe("main");
    expect(defaultStartRef(null)).toBe("");
    expect(
      defaultStartRef({ parent: null, entries: [entry("/a", null, { main: true })] }),
    ).toBe("");
  });
});
