import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { JsonObject, PermissionMode } from "@spiderbyte/sdk";

export const COMPATIBILITY_APPROVAL_METADATA_KEY = "vscode_legacy_approval";

export interface CompatibilityApprovalFlags {
  readonly yolo: boolean;
  readonly afk: boolean;
}

export function readCompatibilityApprovalFlags(
  metadata: Readonly<Record<string, unknown>> | undefined,
): CompatibilityApprovalFlags | undefined {
  const value = metadata?.[COMPATIBILITY_APPROVAL_METADATA_KEY];
  return parseCompatibilityApprovalFlags(value);
}

export async function readMigratedCompatibilityApprovalFlags(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Promise<CompatibilityApprovalFlags | undefined> {
  const sourcePath = metadata?.["spiderbyte_cli_source_path"];
  if (typeof sourcePath !== "string" || sourcePath.length === 0) return undefined;
  let text: string;
  try {
    text = await readFile(join(sourcePath, "state.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const state = JSON.parse(text) as { readonly approval?: unknown };
  return parseCompatibilityApprovalFlags(state.approval);
}

function parseCompatibilityApprovalFlags(value: unknown): CompatibilityApprovalFlags | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const yolo = Reflect.get(value, "yolo");
  const afk = Reflect.get(value, "afk");
  if (typeof yolo !== "boolean" && typeof afk !== "boolean") return undefined;
  return {
    yolo: typeof yolo === "boolean" ? yolo : false,
    afk: typeof afk === "boolean" ? afk : false,
  };
}

export function compatibilityApprovalMetadata(flags: CompatibilityApprovalFlags): JsonObject {
  return {
    [COMPATIBILITY_APPROVAL_METADATA_KEY]: {
      yolo: flags.yolo,
      afk: flags.afk,
    },
  };
}

export function corePermissionForCompatibilityApproval(flags: CompatibilityApprovalFlags): PermissionMode {
  if (flags.afk) return "auto";
  return flags.yolo ? "yolo" : "manual";
}

/**
 * The global `spiderbyte.yoloMode` setting is authoritative whenever a session
 * attaches to the runtime; afk stays per-session because it has no global
 * setting counterpart.
 */
export function withGlobalYoloMode(
  flags: CompatibilityApprovalFlags,
  yoloMode: boolean,
): CompatibilityApprovalFlags {
  return flags.yolo === yoloMode ? flags : { yolo: yoloMode, afk: flags.afk };
}
