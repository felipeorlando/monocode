import { describe, expect, it } from "vitest";
import { compareBaseRows, compareBaseSelection } from "./CompareBasePicker";
import type { GitBranchInfo } from "../lib/fs";

const branches: GitBranchInfo[] = [
  { name: "feature-b", current: true, remote: null },
  { name: "feature-a", current: false, remote: null },
  { name: "main", current: false, remote: null },
  { name: "release-2", current: false, remote: "origin" },
];

describe("compareBaseRows", () => {
  it("offers every local and remote branch as a base", () => {
    expect(compareBaseRows(branches, "", "main").map((row) => row.ref)).toEqual(
      ["feature-b", "feature-a", "main", "origin/release-2"],
    );
  });

  it("marks the repository default", () => {
    const rows = compareBaseRows(branches, "", "main");
    expect(
      rows.filter((row) => row.isDefault).map((row) => row.branch.name),
    ).toEqual(["main"]);
  });

  it("matches on the remote as well as the name", () => {
    expect(
      compareBaseRows(branches, "origin", "main").map((row) => row.branch.name),
    ).toEqual(["release-2"]);
    expect(
      compareBaseRows(branches, "feature-", "main").map((row) => row.ref),
    ).toEqual(["feature-b", "feature-a"]);
  });

  it("treats a repo with no resolvable default as having no default row", () => {
    expect(
      compareBaseRows(branches, "", null).some((row) => row.isDefault),
    ).toBe(false);
  });
});

describe("compareBaseSelection", () => {
  it("stores the default as 'no pick' so a renamed default still applies", () => {
    const [main] = compareBaseRows(branches, "main", "main");
    expect(main && compareBaseSelection(main)).toBeNull();
  });

  it("stores another base by the ref git should compare against", () => {
    const [stacked] = compareBaseRows(branches, "feature-a", "main");
    expect(stacked && compareBaseSelection(stacked)).toBe("feature-a");
    const [release] = compareBaseRows(branches, "release-2", "main");
    expect(release && compareBaseSelection(release)).toBe("origin/release-2");
  });
});
