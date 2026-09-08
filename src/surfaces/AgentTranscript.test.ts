import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Block } from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";

function tool(id: string, approval?: Block["approval"]): Block {
  return {
    id,
    role: "tool",
    text: `Inspect hidden-detail-${id}`,
    tool: { kind: "shell", status: approval ? "pending" : "completed" },
    ...(approval ? { approval } : {}),
  };
}

function render(blocks: Block[], busy = false) {
  return renderToStaticMarkup(createElement(AgentTranscript, { blocks, busy }));
}

describe("AgentTranscript collapsed work", () => {
  it("renders the summary and answer without mounting a large completed tool trail", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Check the project" },
      ...Array.from({ length: 1357 }, (_, index) => tool(String(index))),
      { id: "answer", role: "assistant", text: "The project checks passed." },
    ];
    const markup = render(blocks);
    expect(markup).toContain("The project checks passed.");
    expect(markup).toContain("Show the work");
    expect(markup.includes("hidden-detail-")).toBe(false);
    const short = render([blocks[0], tool("one"), tool("two"), blocks.at(-1)!]);
    const tagCount = (html: string) => html.match(/<[a-z]/g)?.length ?? 0;
    expect(tagCount(markup)).toBe(tagCount(short));
  });

  it("keeps live work visible before the assistant answers", () => {
    expect(render([tool("live")], true)).toContain("hidden-detail-live");
  });

  it("keeps an unresolved approval visible even when narration follows it", () => {
    const markup = render(
      [
        tool("approval", { requestId: 1 }),
        {
          id: "answer",
          role: "assistant",
          text: "Please approve the command.",
        },
      ],
      true,
    );
    expect(markup).toContain("hidden-detail-approval");
    expect(markup).toContain("Please approve the command.");
    expect(markup.includes('aria-label="Show the work"')).toBe(false);
  });
});

/**
 * The prompt-to-top setting is read straight off localStorage while the
 * transcript renders, and the node test environment has none. Stand one up for
 * the duration of a render so both sides of the toggle are reachable.
 */
function renderWithPromptAnchor(blocks: Block[], anchor: boolean) {
  const store = new Map([["monocode.transcriptAnchor", anchor ? "1" : "0"]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: store.size,
    },
  });
  try {
    return render(blocks);
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
}

const PROMPT_TURN: Block[] = [
  { id: "user", role: "user", text: "Check the project" },
  { id: "answer", role: "assistant", text: "The project checks passed." },
];

describe("AgentTranscript sticky prompt", () => {
  it("pins the prompt row while prompts are anchored to the top", () => {
    const markup = renderWithPromptAnchor(PROMPT_TURN, true);
    // The pinned row has to be a direct child of the turn, ahead of the
    // contained body: inside it, sticky would resolve against the body box.
    expect(markup).toMatch(
      /class="transcript-turn [^"]*"><div class="[^"]*sticky top-0"[^>]*>.*Check the project/,
    );
  });

  it("leaves the prompt row unpinned when the setting is off", () => {
    const markup = renderWithPromptAnchor(PROMPT_TURN, false);
    expect(markup).toContain("Check the project");
    expect(markup.includes("sticky top-0")).toBe(false);
  });

  it("stacks pinned prompts in transcript order", () => {
    const markup = renderWithPromptAnchor(
      [...PROMPT_TURN, { id: "user-2", role: "user", text: "And again" }],
      true,
    );
    const zIndexes = [...markup.matchAll(/z-index:(\d+)/g)].map((match) =>
      Number(match[1]),
    );
    expect(zIndexes).toEqual([1, 2]);
  });

  it("virtualizes the turn body, not the wrapper the prompt sticks to", () => {
    const markup = renderWithPromptAnchor(PROMPT_TURN, true);
    expect(markup).toContain('class="transcript-turn-body');
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    const rule = (selector: string) =>
      css.match(new RegExp(`\\${selector} \\{[^}]*\\}`))?.[0] ?? "";
    expect(rule(".transcript-turn-body")).toContain("content-visibility: auto");
    expect(rule(".transcript-turn")).toBe("");
  });
});
