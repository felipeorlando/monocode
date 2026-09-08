import { beforeEach, describe, expect, it, vi } from "vitest";
import { isCheckoutBlockedByChanges, restoreSessionCheckout } from "./fs";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

describe("isCheckoutBlockedByChanges", () => {
  it("detects git's tracked-file checkout error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\nPlease commit your changes or stash them before you switch branches.",
      ),
    ).toBe(true);
  });

  it("detects git's untracked-file checkout error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "error: The following untracked working tree files would be overwritten by checkout:\n\tnew.txt\nPlease move or remove them before you switch branches.",
      ),
    ).toBe(true);
  });

  it("detects the mapped app error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "Your local changes would be overwritten. Commit or stash them first.",
      ),
    ).toBe(true);
  });

  it("ignores unrelated git errors", () => {
    expect(isCheckoutBlockedByChanges("Branch missing not found")).toBe(false);
    expect(isCheckoutBlockedByChanges("Not a git repository")).toBe(false);
  });
});

describe("restoreSessionCheckout", () => {
  const REPO = "/projects/monocode";
  const WORKTREE = "/projects/monocode-worktrees/feat-picker";

  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("leaves an unpinned session untouched without asking git", async () => {
    const session = { cwd: REPO, providerSessionId: "acp-1" };
    await expect(restoreSessionCheckout(session)).resolves.toBe(session);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps the pin while the worktree is still a tree of the repo", async () => {
    mocks.invoke.mockResolvedValue(true);
    const session = {
      cwd: REPO,
      worktreeCwd: WORKTREE,
      providerSessionId: "acp-1",
    };
    await expect(restoreSessionCheckout(session)).resolves.toBe(session);
    expect(mocks.invoke).toHaveBeenCalledWith("git_worktree_verify", {
      cwd: REPO,
      path: WORKTREE,
    });
  });

  it("falls back to the main checkout when the worktree is gone", async () => {
    mocks.invoke.mockResolvedValue(false);
    const restored = await restoreSessionCheckout({
      cwd: REPO,
      worktreeCwd: WORKTREE,
      providerSessionId: "acp-1",
    });
    expect(restored.worktreeCwd).toBeUndefined();
    expect(restored.providerSessionId).toBeUndefined();
    expect(restored.cwd).toBe(REPO);
  });

  it("falls back when the verify call itself fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("Not a git repository"));
    const restored = await restoreSessionCheckout({
      cwd: REPO,
      worktreeCwd: WORKTREE,
    });
    expect(restored.worktreeCwd).toBeUndefined();
  });

  it("drops the dead branch pin but keeps a live worktree", async () => {
    mocks.invoke.mockResolvedValue(true);
    const restored = await restoreSessionCheckout({
      cwd: REPO,
      branch: "feat/old",
      worktreeCwd: WORKTREE,
      providerSessionId: "acp-1",
    });
    expect(restored.branch).toBeUndefined();
    expect(restored.worktreeCwd).toBe(WORKTREE);
    // The directory did not move, so the conversation is still valid.
    expect(restored.providerSessionId).toBe("acp-1");
  });

  it("drops a branch-only pin without touching git", async () => {
    const restored = await restoreSessionCheckout({
      cwd: REPO,
      branch: "feat/old",
      providerSessionId: "acp-1",
    });
    expect(restored.branch).toBeUndefined();
    expect(restored.providerSessionId).toBe("acp-1");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
