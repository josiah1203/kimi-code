/**
 * Scenario: App-level view routing for local and BYOK model configuration.
 * Wiring: resolveAppView is pure; the bridge and toast boundaries are mocked away.
 * Run: pnpm exec vitest run --config apps/spiderbyte-vscode/vitest.config.ts test/app-init.test.ts
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/services", () => ({
  bridge: {},
  Events: {},
}));
vi.mock("@/components/ui/sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

import { resolveAppView, type AppStatus } from "../webview-ui/src/hooks/useAppInit";

function resolve(
  status: AppStatus,
  options: { modelsCount?: number } = {},
) {
  return resolveAppView({
    status,
    modelsCount: options.modelsCount ?? 0,
  });
}

describe("resolveAppView", () => {
  it("routes a missing local model configuration to the status screen", () => {
    expect(resolve("no-models")).toEqual({
      view: "status",
      status: "no-models",
      canGoToLogin: false,
    });
  });

  it("routes ready to the main view", () => {
    expect(resolve("ready", { modelsCount: 1 })).toEqual({ view: "main" });
  });

  it("routes non-login error statuses to status screens without a sign-in path", () => {
    for (const status of ["loading", "no-workspace", "runtime-error"] as const) {
      expect(resolve(status)).toEqual({ view: "status", status, canGoToLogin: false });
    }
  });
});
