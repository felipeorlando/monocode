import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RATE_LIMITS_CACHE_KEY,
  RATE_LIMITS_LOCK_KEY,
  getRateLimitsSnapshot,
  refreshRateLimits,
  resetRateLimitsStoreForTests,
  setRateLimitFetchersForTests,
  setRateLimitProviders,
  subscribeRateLimits,
} from "./rateLimitsStore";
import { idleRateLimits, type ProviderRateLimits } from "./rateLimits";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

function okLimits(
  provider: ProviderRateLimits["provider"],
  usedPercent: number,
): ProviderRateLimits {
  return {
    provider,
    session: { usedPercent, windowMinutes: 300, resetsAt: null },
    weekly: null,
    updatedAt: Date.now(),
    error: null,
    status: "ok",
  };
}

describe("rateLimitsStore", () => {
  beforeEach(() => {
    mockLocalStorage();
    resetRateLimitsStoreForTests();
  });

  afterEach(() => {
    resetRateLimitsStoreForTests();
  });

  it("keeps the cache across unsubscribe so remounts do not refetch", async () => {
    const claude = vi.fn(async () => okLimits("claude", 12));
    setRateLimitFetchersForTests({
      claude,
      codex: vi.fn(async () => idleRateLimits("codex")),
      cursor: vi.fn(async () => idleRateLimits("cursor")),
      grok: vi.fn(async () => idleRateLimits("grok")),
    });
    const stop = subscribeRateLimits(() => undefined);
    setRateLimitProviders(["claude"]);
    await refreshRateLimits();
    expect(claude).toHaveBeenCalledTimes(1);
    expect(getRateLimitsSnapshot().claude.session?.usedPercent).toBe(12);
    stop();

    const stopAgain = subscribeRateLimits(() => undefined);
    setRateLimitProviders(["claude"]);
    await refreshRateLimits();
    expect(claude).toHaveBeenCalledTimes(1);
    expect(getRateLimitsSnapshot().claude.session?.usedPercent).toBe(12);
    stopAgain();
  });

  it("skips a fetch when another window holds the lock", async () => {
    const claude = vi.fn(async () => okLimits("claude", 12));
    setRateLimitFetchersForTests({
      claude,
      codex: vi.fn(async () => idleRateLimits("codex")),
      cursor: vi.fn(async () => idleRateLimits("cursor")),
      grok: vi.fn(async () => idleRateLimits("grok")),
    });
    localStorage.setItem(
      RATE_LIMITS_LOCK_KEY,
      JSON.stringify({ at: Date.now() }),
    );
    subscribeRateLimits(() => undefined);
    setRateLimitProviders(["claude"]);
    await refreshRateLimits();
    expect(claude).not.toHaveBeenCalled();
  });

  it("hydrates from a cache written by another window", () => {
    localStorage.setItem(
      RATE_LIMITS_CACHE_KEY,
      JSON.stringify({ claude: okLimits("claude", 41) }),
    );
    subscribeRateLimits(() => undefined);
    expect(getRateLimitsSnapshot().claude.session?.usedPercent).toBe(41);
  });
});
