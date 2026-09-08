import type { FollowUpBehavior } from "./settings";

/** What a follow-up does to a running turn once the keystroke is known. */
export type FollowUpAction = "queue" | "steer";

type SteerShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "metaKey" | "ctrlKey"
>;

/**
 * True when Enter arrived with the platform steer modifier held: ⌘ on macOS,
 * Ctrl everywhere else. Shift+Enter is the newline, so it never counts.
 * The composer reads this on every submit; whether it means anything is up to
 * the follow-up setting.
 */
export function isSteerShortcut(
  e: SteerShortcutEvent,
  isMac: boolean,
): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  return isMac ? e.metaKey : e.ctrlKey;
}

/**
 * Fold the global setting and the keystroke into the action for this one
 * follow-up. Only `queue-steer` looks at the modifier — the single-behavior
 * modes stay unconditional so existing muscle memory keeps working.
 */
export function resolveFollowUpAction(
  behavior: FollowUpBehavior,
  steerShortcut: boolean,
): FollowUpAction {
  if (behavior === "queue-steer") return steerShortcut ? "steer" : "queue";
  return behavior === "queue" ? "queue" : "steer";
}
