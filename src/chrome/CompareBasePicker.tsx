import { Check, ChevronDown, GitBranch, Search } from "./icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { compareBaseRefName } from "../lib/compareBase";
import type { GitBranchInfo } from "../lib/fs";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { Popover } from "./Popover";

type Props = {
  cwd: string;
  /** Base the panel is actually diffing against, as resolved by git. */
  base: string | null;
  /** Repository default, offered as the way back to stock behaviour. */
  defaultBranch: string | null;
  enabled?: boolean;
  /** `null` clears the pick and returns the folder to the repository default. */
  onPick: (base: string | null) => void;
};

const MENU_WIDTH = 260;
const MENU_MIN_HEIGHT = 180;
const MENU_MAX_HEIGHT = 280;

export type CompareBaseRow = {
  branch: GitBranchInfo;
  /** What the backend is asked to compare against for this row. */
  ref: string;
  isDefault: boolean;
};

/** Filtered branch rows, each tagged with the ref the backend should receive. */
export function compareBaseRows(
  branches: GitBranchInfo[],
  query: string,
  defaultBranch: string | null,
): CompareBaseRow[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? branches.filter((entry) => {
        const hay = entry.remote ? `${entry.name} ${entry.remote}` : entry.name;
        return hay.toLowerCase().includes(needle);
      })
    : branches;
  return matches.map((branch) => ({
    branch,
    ref: compareBaseRefName(branch),
    isDefault: !!defaultBranch && branch.name === defaultBranch,
  }));
}

/**
 * The value to persist for a row. The repository default is stored as `null`
 * so a repo that later renames its default branch follows along instead of
 * staying pinned to the old name.
 */
export function compareBaseSelection(row: CompareBaseRow): string | null {
  return row.isDefault ? null : row.ref;
}

/**
 * Picks the ref the current branch is compared against. Unlike `BranchPicker`
 * this never touches the checkout — it only changes what HEAD is diffed with.
 */
export function CompareBasePicker({
  cwd,
  base,
  defaultBranch,
  enabled = true,
  onPick,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const inProject = Boolean(cwd) && cwd !== "~";
  const { branches } = useProjectBranchesState(cwd, inProject && open);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    search.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  const rows = useMemo(
    () => compareBaseRows(branches?.branches ?? [], query, defaultBranch),
    [branches, defaultBranch, query],
  );

  useEffect(() => {
    setActive((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const pick = (row: CompareBaseRow) => {
    onPick(compareBaseSelection(row));
    setOpen(false);
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length > 0) setActive((i) => Math.min(rows.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length > 0) setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) pick(row);
    }
  };

  const label = base ?? "no base";
  const interactive = enabled && inProject;

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        title={`Compare against ${label}`}
        aria-label={`Compare base ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!interactive}
        onClick={() => setOpen((value) => !value)}
        className={`flex min-w-0 items-center gap-1 rounded px-1 ${
          open ? "text-content" : "text-content/60 hover:text-content"
        } disabled:opacity-40 disabled:hover:text-content/60`}
      >
        <span className="min-w-0 truncate font-mono text-[11px]">{label}</span>
        <ChevronDown className="size-3 shrink-0" strokeWidth={1.75} />
      </button>
      {open ? (
        <Popover
          anchor={root}
          side="bottom"
          align="end"
          width={MENU_WIDTH}
          minHeight={MENU_MIN_HEIGHT}
          maxHeight={MENU_MAX_HEIGHT}
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label="Compare base picker"
          data-compare-base-picker
          className="flex flex-col overflow-hidden"
        >
          <label className="flex shrink-0 items-center gap-2 border-b border-content/10 px-2 py-2.5 text-content/50">
            <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
            <input
              ref={search}
              type="text"
              value={query}
              placeholder="Compare against..."
              aria-label="Search branches to compare against"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/40"
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
            />
          </label>
          <BaseList
            rows={rows}
            base={base}
            active={active}
            emptyLabel={
              branches
                ? query.trim()
                  ? "No matching branches"
                  : "No branches"
                : "Loading branches…"
            }
            onActive={setActive}
            onPick={pick}
          />
        </Popover>
      ) : null}
    </div>
  );
}

function BaseList({
  rows,
  base,
  active,
  emptyLabel,
  onActive,
  onPick,
}: {
  rows: CompareBaseRow[];
  base: string | null;
  active: number;
  emptyLabel: string;
  onActive: (index: number) => void;
  onPick: (row: CompareBaseRow) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (rows.length === 0) {
    return (
      <div className="px-3 py-4 text-[12px] text-content/50">{emptyLabel}</div>
    );
  }

  return (
    <div
      ref={lockOverscroll}
      role="listbox"
      aria-label="Compare bases"
      className="min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 py-1.5"
    >
      {rows.map((row, index) => {
        const highlighted = index === active;
        // `base` comes back from git already stripped of its remote prefix, so
        // a remote-only branch matches on name.
        const selected = row.branch.name === base;
        return (
          <button
            key={`${row.branch.remote ?? "local"}:${row.branch.name}`}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={selected}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onActive(index)}
            onClick={() => onPick(row)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
              highlighted || selected
                ? "bg-content/10 text-content"
                : "text-content hover:bg-content/5"
            }`}
          >
            {selected ? (
              <Check className="size-3.5 shrink-0" strokeWidth={1.75} />
            ) : (
              <GitBranch
                className="size-3.5 shrink-0 text-content/50"
                strokeWidth={1.75}
              />
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
              {row.branch.name}
            </span>
            {row.isDefault ? (
              <span className="shrink-0 text-[10px] text-content/40">
                default
              </span>
            ) : row.branch.remote ? (
              <span className="shrink-0 text-[10px] text-content/40">
                {row.branch.remote}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
