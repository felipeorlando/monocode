import { beforeEach, describe, expect, it } from "vitest";
import {
  compareBaseRefName,
  loadCompareBase,
  saveCompareBase,
} from "./compareBase";

const KEY = "monocode.compareBase.v1";

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

describe("compare base", () => {
  beforeEach(mockLocalStorage);

  it("defaults to the repository default before anything is picked", () => {
    expect(loadCompareBase("/repos/web")).toBeNull();
  });

  it("remembers a pick per folder", () => {
    saveCompareBase("/repos/web", "release-2");
    saveCompareBase("/repos/web-worktree", "feature-a");
    expect(loadCompareBase("/repos/web")).toBe("release-2");
    expect(loadCompareBase("/repos/web-worktree")).toBe("feature-a");
  });

  it("keeps folders that share a name apart", () => {
    saveCompareBase("/acme/web", "release-2");
    expect(loadCompareBase("/other/web")).toBeNull();
  });

  it("clears the pick back to the default", () => {
    saveCompareBase("/repos/web", "release-2");
    saveCompareBase("/repos/web", null);
    expect(loadCompareBase("/repos/web")).toBeNull();
  });

  it("ignores a corrupt store instead of throwing", () => {
    localStorage.setItem(KEY, "not json");
    expect(loadCompareBase("/repos/web")).toBeNull();
    saveCompareBase("/repos/web", "main");
    expect(loadCompareBase("/repos/web")).toBe("main");
  });

  it("has no base for a folder that is not a project", () => {
    saveCompareBase("~", "main");
    expect(loadCompareBase("~")).toBeNull();
  });

  it("qualifies remote-only branches so the remote cannot be guessed wrong", () => {
    expect(compareBaseRefName({ name: "main", remote: null })).toBe("main");
    expect(compareBaseRefName({ name: "main", remote: "upstream" })).toBe(
      "upstream/main",
    );
  });
});
