import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

import {
  parseAgentFileText,
  resolveAgentPath,
  type LogContext,
  type LogLevel,
  type LogPayload,
} from '@spiderbyte/agent-core';
import { installGlobalProxyDispatcher as installProxyDispatcher } from '@spiderbyte/agent-core/_base/utils/proxy';

import { SpiderByteError, ErrorCodes } from '#/errors';
import type { SpiderByteConfig, ModelAlias } from '#/types';

export interface Logger {
  error(message: string, payload?: LogPayload): void;
  warn(message: string, payload?: LogPayload): void;
  info(message: string, payload?: LogPayload): void;
  debug(message: string, payload?: LogPayload): void;
  child?(context: LogContext): Logger;
}

export type { LogContext, LogLevel, LogPayload };

function write(level: 'error' | 'warn' | 'info' | 'debug', message: string, payload?: unknown): void {
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (payload === undefined) target(`[SpiderByte] ${message}`);
  else target(`[SpiderByte] ${message}`, redact(payload));
}

export const log: Logger = {
  error: (message, payload) => write('error', message, payload),
  warn: (message, payload) => write('warn', message, payload),
  info: (message, payload) => write('info', message, payload),
  debug: (message, payload) => write('debug', message, payload),
  child: () => log,
};

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/(api[_-]?key|token|secret|password)=?[^\s,}]+/gi, '$1=[REDACTED]');
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = /api[_-]?key|token|secret|password|authorization/i.test(key) ? '[REDACTED]' : redact(entry);
    }
    return output;
  }
  return value;
}

export function resolveSpiderByteHome(homeDir?: string, env: NodeJS.ProcessEnv = process.env): string {
  return homeDir ?? env['SPIDERBYTE_HOME'] ?? env['SPIDERBYTE_HOME'] ?? join(homedir(), '.spiderbyte');
}

export function resolveConfigPath(input: { readonly homeDir?: string; readonly configPath?: string } = {}): string {
  return input.configPath ?? join(input.homeDir ?? resolveSpiderByteHome(), 'config.toml');
}

export function resolveGlobalLogPath(homeDir: string): string {
  return join(homeDir, 'logs', 'spiderbyte.log');
}

export async function flushDiagnosticLogs(): Promise<void> {}
export function flushDiagnosticLogsSync(): void {}

export function installGlobalProxyDispatcher(env: NodeJS.ProcessEnv = process.env): boolean {
  return installProxyDispatcher(env);
}

export interface RuntimeConfigLoadResult {
  readonly config: SpiderByteConfig;
  readonly fileError?: SpiderByteError;
}

export function loadRuntimeConfigSafe(filePath: string): RuntimeConfigLoadResult {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: { providers: {} } };
    }
    return {
      config: { providers: {} },
      fileError: new SpiderByteError(ErrorCodes.CONFIG_INVALID, `Failed to read ${filePath}.`, { cause: error }),
    };
  }
  try {
    const parsed = parseToml(text);
    return { config: { providers: {}, ...(parsed as Record<string, unknown>) } as SpiderByteConfig };
  } catch (error) {
    return {
      config: { providers: {} },
      fileError: new SpiderByteError(ErrorCodes.CONFIG_INVALID, `Invalid TOML in ${filePath}.`, { cause: error }),
    };
  }
}

export function effectiveModelAlias(alias: ModelAlias, _providerType?: string): ModelAlias {
  const effective = alias.overrides === undefined ? { ...alias } : { ...alias, ...alias.overrides };
  delete effective.overrides;
  if (effective.maxInputSize !== undefined && effective.maxInputSize > effective.maxContextSize) {
    effective.maxInputSize = effective.maxContextSize;
  }
  return effective;
}

export { parseAgentFileText, resolveAgentPath };
