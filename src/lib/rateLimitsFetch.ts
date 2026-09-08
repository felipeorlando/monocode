import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "./fs";
import {
  errorRateLimits,
  parseClaudeOAuthUsage,
  parseCodexRateLimits,
  parseCursorUsageSummary,
  parseGrokBilling,
  unavailableRateLimits,
  type ProviderRateLimits,
} from "./rateLimits";
import {
  killChild,
  resolveCodexBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "./harness/child";
import { asRecord } from "./harness/codexProtocol";
import { JsonRpcClient } from "./harness/jsonRpc";

const USAGE_CHILD_ID = "monocode-codex-usage";
const DISCOVERY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 12_000;

type UsageFetch = {
  status: "ok" | "error" | "unavailable" | string;
  httpStatus?: number | null;
  body?: string | null;
  error?: string | null;
};

export async function fetchClaudeRateLimits(): Promise<ProviderRateLimits> {
  try {
    const result = await invoke<UsageFetch>("fetch_claude_usage");
    if (result.status === "ok" && result.body) {
      const parsed = parseClaudeOAuthUsage(result.body);
      if (parsed.session || parsed.weekly) return parsed;
      return {
        ...parsed,
        status: parsed.status === "ok" ? "ok" : parsed.status,
      };
    }
    if (result.status === "unavailable") {
      return unavailableRateLimits(
        "claude",
        result.error?.trim() || "Claude not signed in",
      );
    }
    return errorRateLimits(
      "claude",
      result.error?.trim() || "Claude usage unavailable",
    );
  } catch (error) {
    return errorRateLimits(
      "claude",
      error instanceof Error ? error.message : "Claude usage unavailable",
    );
  }
}

export async function fetchCursorRateLimits(): Promise<ProviderRateLimits> {
  try {
    const result = await invoke<UsageFetch>("fetch_cursor_usage");
    if (result.status === "ok" && result.body) {
      const parsed = parseCursorUsageSummary(result.body);
      if (parsed.session || parsed.weekly) return parsed;
      return {
        ...parsed,
        status: parsed.status === "ok" ? "ok" : parsed.status,
      };
    }
    if (result.status === "unavailable") {
      return unavailableRateLimits(
        "cursor",
        result.error?.trim() || "Cursor not signed in",
      );
    }
    return errorRateLimits(
      "cursor",
      result.error?.trim() || "Cursor usage unavailable",
    );
  } catch (error) {
    return errorRateLimits(
      "cursor",
      error instanceof Error ? error.message : "Cursor usage unavailable",
    );
  }
}

export async function fetchGrokRateLimits(): Promise<ProviderRateLimits> {
  try {
    const result = await invoke<UsageFetch>("fetch_grok_usage");
    if (result.status === "ok" && result.body) {
      const parsed = parseGrokBilling(result.body);
      if (parsed.session || parsed.weekly) return parsed;
      return {
        ...parsed,
        status: parsed.status === "ok" ? "ok" : parsed.status,
      };
    }
    if (result.status === "unavailable") {
      return unavailableRateLimits(
        "grok",
        result.error?.trim() || "Grok not signed in",
      );
    }
    return errorRateLimits(
      "grok",
      result.error?.trim() || "Grok usage unavailable",
    );
  } catch (error) {
    return errorRateLimits(
      "grok",
      error instanceof Error ? error.message : "Grok usage unavailable",
    );
  }
}

export async function fetchCodexRateLimits(): Promise<ProviderRateLimits> {
  let path: string;
  try {
    path = (await resolveCodexBinary()).path;
  } catch {
    return unavailableRateLimits("codex", "Codex CLI not found");
  }

  const cwd = await homeDir();
  const rpc = new JsonRpcClient(
    USAGE_CHILD_ID,
    {
      onRequest: (id) => {
        void rpc.respond(id, {}).catch(() => undefined);
      },
    },
    { includeJsonrpc: false, label: "codex-usage" },
  );

  const stop = async () => {
    rpc.close();
    unwatchChild(USAGE_CHILD_ID);
    await killChild(USAGE_CHILD_ID).catch(() => undefined);
  };

  await killChild(USAGE_CHILD_ID).catch(() => undefined);

  watchChild(
    USAGE_CHILD_ID,
    (line) => rpc.pushLine(line),
    () => rpc.close(new Error("Codex usage probe exited")),
  );

  try {
    await spawnChild(USAGE_CHILD_ID, path, ["app-server"], cwd);
    return await withTimeout(
      DISCOVERY_TIMEOUT_MS,
      async () => {
        await rpc.request(
          "initialize",
          {
            clientInfo: {
              name: "monocode",
              title: "MonoCode",
              version: "0.1.0",
            },
            capabilities: { experimentalApi: true },
          },
          REQUEST_TIMEOUT_MS,
        );
        await rpc.notify("initialized", undefined);

        const result = await rpc.request<unknown>(
          "account/rateLimits/read",
          {},
          REQUEST_TIMEOUT_MS,
        );
        const parsed = parseCodexRateLimits(result);
        if (parsed.session || parsed.weekly) return parsed;
        const rec = asRecord(result);
        if (rec && !parsed.session && !parsed.weekly) {
          return unavailableRateLimits("codex", "No Codex usage data");
        }
        return parsed;
      },
      () => {
        void stop();
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /not signed in|chatgpt authentication required|not authenticated/i.test(
        message,
      )
    ) {
      return unavailableRateLimits("codex", "Codex not signed in");
    }
    if (/ENOENT|not found|could not run/i.test(message)) {
      return unavailableRateLimits("codex", "Codex CLI not found");
    }
    return errorRateLimits("codex", message);
  } finally {
    await stop();
  }
}

async function withTimeout<T>(
  ms: number,
  work: () => Promise<T>,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = work();
  try {
    return await Promise.race([
      pending,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error("Codex usage probe timed out"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    void pending.catch(() => undefined);
  }
}
