import { describe, expect, it } from "vitest";
import { isSteerShortcut, resolveFollowUpAction } from "./followUp";

function key(
  patch: Partial<
    Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey">
  > = {},
) {
  return {
    key: "Enter",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...patch,
  };
}

describe("isSteerShortcut", () => {
  it("reads ⌘+Enter on macOS and Ctrl+Enter elsewhere", () => {
    expect(isSteerShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isSteerShortcut(key({ ctrlKey: true }), false)).toBe(true);
  });

  it("ignores the other platform's modifier", () => {
    expect(isSteerShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isSteerShortcut(key({ metaKey: true }), false)).toBe(false);
  });

  it("is false for a plain Enter", () => {
    expect(isSteerShortcut(key(), true)).toBe(false);
    expect(isSteerShortcut(key(), false)).toBe(false);
  });

  it("leaves Shift+Enter alone so it stays a newline", () => {
    expect(isSteerShortcut(key({ metaKey: true, shiftKey: true }), true)).toBe(
      false,
    );
    expect(isSteerShortcut(key({ ctrlKey: true, shiftKey: true }), false)).toBe(
      false,
    );
  });

  it("only fires on Enter", () => {
    expect(isSteerShortcut(key({ key: "k", metaKey: true }), true)).toBe(false);
  });
});

describe("resolveFollowUpAction", () => {
  it("keeps the single-behavior modes unconditional", () => {
    expect(resolveFollowUpAction("queue", false)).toBe("queue");
    expect(resolveFollowUpAction("queue", true)).toBe("queue");
    expect(resolveFollowUpAction("steer", false)).toBe("steer");
    expect(resolveFollowUpAction("steer", true)).toBe("steer");
  });

  it("queues on plain Enter and steers on the shortcut", () => {
    expect(resolveFollowUpAction("queue-steer", false)).toBe("queue");
    expect(resolveFollowUpAction("queue-steer", true)).toBe("steer");
  });
});
