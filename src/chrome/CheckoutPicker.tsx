import { Check, FolderOpen, Lock, Plus, Search } from "./icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  gitWorktreeCreate,
  gitWorktrees,
  notifyGitChanged,
  subscribeGitChanged,
  type GitWorktreeList,
} from "../lib/fs";
import { prettyCwd } from "../lib/paths";
import {
  checkoutLabel,
  checkoutRows,
  defaultStartRef,
  isSessionCheckout,
  type CheckoutRow,
  type SessionCheckout,
} from "../lib/sessionCheckout";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { Popover } from "./Popover";

type Props = {
  /** Repository the session belongs to. */
  cwd: string;
  /** Linked worktree the session is pinned to, if any. */
  worktreeCwd?: string;
  enabled?: boolean;
  onChange: (checkout: SessionCheckout) => void;
  onClose?: () => void;
};

const MENU_WIDTH = 320;
const MENU_MIN_HEIGHT = 180;
const MENU_MAX_HEIGHT = 300;

export function CheckoutPicker({
  cwd,
  worktreeCwd,
  enabled = true,
  onChange,
  onClose,
}: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<GitWorktreeList | null>(null);
  /** First lookup for this folder has answered, repository or not. */
  const [settled, setSettled] = useState(false);
  const [query, setQuery] = useState("");
  const [startRef, setStartRef] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const inProject = Boolean(cwd) && cwd !== "~";
  const { branches: projectBranches } = useProjectBranchesState(cwd, open);
  const session = useMemo(() => ({ cwd, worktreeCwd }), [cwd, worktreeCwd]);
  const liveRef = useRef(0);

  const reload = useCallback(() => {
    if (!inProject) {
      setList(null);
      setSettled(true);
      return;
    }
    // Late answers for a folder we have already left must not overwrite the
    // list the user is looking at now.
    const token = ++liveRef.current;
    gitWorktrees(cwd)
      .then((next) => {
        if (token !== liveRef.current) return;
        setList(next);
        setSettled(true);
        // The start point defaults to wherever the main checkout sits, so a new
        // worktree branches from what the user last had in front of them.
        setStartRef((current) => current || defaultStartRef(next));
      })
      .catch(() => {
        if (token !== liveRef.current) return;
        setList(null);
        setSettled(true);
      });
  }, [cwd, inProject]);

  // Listed up front, not on open, so the control can stay out of the toolbar
  // entirely for a folder that is not a git repository.
  useEffect(() => {
    setSettled(false);
    reload();
    return subscribeGitChanged(reload);
  }, [reload]);

  const dismiss = (restore: boolean) => {
    setOpen(false);
    setQuery("");
    setError(null);
    setBusy(false);
    setActive(0);
    if (restore) onCloseRef.current?.();
  };

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  useEffect(() => {
    if (enabled) return;
    setOpen(false);
    setBusy(false);
    setError(null);
  }, [enabled]);

  const localBranches = useMemo(
    () =>
      (projectBranches?.branches ?? [])
        .filter((entry) => !entry.remote)
        .map((entry) => entry.name),
    [projectBranches],
  );
  const rows = useMemo(
    () => checkoutRows(list, query, localBranches),
    [list, localBranches, query],
  );

  useEffect(() => {
    setActive((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const failMessage = (err: unknown) =>
    err instanceof Error ? err.message : String(err);

  const select = (checkout: SessionCheckout) => {
    onChangeRef.current(checkout);
    dismiss(true);
  };

  const create = async (branch: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await gitWorktreeCreate(cwd, branch, startRef);
      // A new branch landed in the repository even though this checkout never
      // moved, so anything reading refs needs to hear about it.
      notifyGitChanged();
      select({ kind: "worktree", path: created.path });
    } catch (err) {
      // The main checkout is untouched on failure; keep the menu open with the
      // git error so the name or start point can be fixed in place.
      setError(failMessage(err));
      setBusy(false);
      search.current?.focus();
    }
  };

  const pick = (row: CheckoutRow) => {
    if (busy) return;
    if (row.kind === "create") {
      void create(row.branch);
      return;
    }
    if (isSessionCheckout(session, row.entry)) {
      dismiss(true);
      return;
    }
    select(
      row.entry.main
        ? { kind: "main" }
        : { kind: "worktree", path: row.entry.path },
    );
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

  const selected = useMemo(
    () => (list?.entries ?? []).find((entry) => isSessionCheckout(session, entry)),
    [list, session],
  );
  // The trigger has to read correctly before the list has loaded, and a pinned
  // worktree already knows its own folder name.
  const label = selected
    ? checkoutLabel(selected)
    : worktreeCwd
      ? checkoutLabel({
          path: worktreeCwd,
          branch: null,
          main: false,
          prunable: false,
          locked: false,
        })
      : "Main checkout";
  const creating = rows[active]?.kind === "create";

  // Nothing to choose between until git has answered, and nothing at all when
  // the folder is not a repository — the branch picker already says so.
  if (!settled || (list?.entries.length ?? 0) === 0) return null;

  return (
    <div ref={root} className="relative flex min-w-0 shrink items-center">
      <button
        type="button"
        title={worktreeCwd ? `Worktree ${worktreeCwd}` : `Checkout ${cwd}`}
        aria-label={`Checkout ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={!enabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!enabled) return;
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        className={`flex min-w-0 items-center gap-1.5 ${
          open ? "text-content" : "text-content/50 hover:text-content"
        } disabled:opacity-40 disabled:hover:text-content/50`}
      >
        <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.5} />
        <span className="truncate font-mono text-[12px]">{label}</span>
      </button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          width={MENU_WIDTH}
          minHeight={MENU_MIN_HEIGHT}
          maxHeight={MENU_MAX_HEIGHT}
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="dialog"
          aria-label="Checkout picker"
          data-checkout-picker
          className="flex flex-col overflow-hidden"
        >
          <label className="flex shrink-0 items-center gap-2 border-b border-content/10 px-2 py-2.5 text-content/50">
            <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
            <input
              ref={search}
              type="text"
              value={query}
              placeholder="Search or name a new worktree..."
              aria-label="Search or name a new worktree"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              disabled={busy}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/40 disabled:opacity-60"
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setError(null);
              }}
              onKeyDown={onSearchKey}
            />
          </label>
          <CheckoutList
            rows={rows}
            active={active}
            busy={busy}
            selectedPath={selected?.path}
            mainSelected={!worktreeCwd}
            emptyLabel={
              query.trim() ? "No matching worktrees" : "No worktrees"
            }
            onActive={setActive}
            onPick={pick}
          />
          {creating ? (
            <label className="flex shrink-0 items-center gap-2 border-t border-content/10 px-2.5 py-2 text-content/50">
              <span className="shrink-0 text-[11px]">Start from</span>
              <input
                type="text"
                value={startRef}
                placeholder="HEAD"
                aria-label="Start the new worktree from"
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-content outline-none placeholder:text-content/40 disabled:opacity-60"
                onChange={(e) => {
                  setStartRef(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const row = rows[active];
                  if (row) pick(row);
                }}
              />
            </label>
          ) : null}
          {creating && list?.parent ? (
            <p className="shrink-0 truncate border-t border-content/10 px-2.5 py-1.5 font-mono text-[10px] text-content/40">
              in {prettyCwd(list.parent)}
            </p>
          ) : null}
          {error ? (
            <p className="max-h-16 shrink-0 overflow-y-auto whitespace-pre-wrap border-t border-content/10 px-2.5 py-2 text-[11px] leading-4 text-red-400/90">
              {error}
            </p>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}

function CheckoutList({
  rows,
  active,
  busy,
  selectedPath,
  mainSelected,
  emptyLabel,
  onActive,
  onPick,
}: {
  rows: CheckoutRow[];
  active: number;
  busy: boolean;
  selectedPath?: string;
  mainSelected: boolean;
  emptyLabel: string;
  onActive: (index: number) => void;
  onPick: (row: CheckoutRow) => void;
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
      aria-label="Checkouts"
      className="min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 py-1.5"
    >
      {rows.map((row, index) => {
        const highlighted = index === active;
        const selected =
          row.kind === "checkout" &&
          (row.entry.main ? mainSelected : row.entry.path === selectedPath);
        return (
          <button
            key={
              row.kind === "create" ? `create:${row.branch}` : row.entry.path
            }
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={busy}
            title={row.kind === "create" ? undefined : row.entry.path}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onActive(index)}
            onClick={() => onPick(row)}
            className={
              row.kind === "create"
                ? `mb-1 flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left disabled:opacity-60 ${
                    highlighted
                      ? "bg-content/15 text-content"
                      : "bg-content/10 text-content hover:bg-content/15"
                  }`
                : `flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left disabled:opacity-60 ${
                    highlighted || selected
                      ? "bg-content/10 text-content"
                      : "text-content hover:bg-content/5"
                  }`
            }
          >
            {row.kind === "create" ? (
              <>
                <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 truncate text-[12px]">
                  Create worktree {row.branch}
                </span>
              </>
            ) : (
              <>
                {selected ? (
                  <Check className="size-3.5 shrink-0" strokeWidth={1.75} />
                ) : (
                  <FolderOpen
                    className="size-3.5 shrink-0 text-content/50"
                    strokeWidth={1.75}
                  />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                  {checkoutLabel(row.entry)}
                </span>
                {row.entry.locked ? (
                  <Lock
                    className="size-3 shrink-0 text-content/40"
                    strokeWidth={1.75}
                  />
                ) : null}
                {row.entry.main ? (
                  <span className="shrink-0 text-[10px] text-content/40">
                    {row.entry.branch ?? "detached"}
                  </span>
                ) : null}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
