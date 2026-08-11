import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { ErrorCodes, SpiderByteError } from '#/errors';
import { z } from 'zod';

export type SpiderByteConfigValidationPathSegment = string | number;

export interface SpiderByteConfigValidationIssue {
  readonly path: readonly SpiderByteConfigValidationPathSegment[];
  readonly message: string;
}

export interface ResolveSpiderByteConfigPathInput {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
}

export interface ValidateSpiderByteConfigTomlInput {
  readonly text: string;
  readonly filePath?: string | undefined;
}

export interface SpiderByteConfigRpc {
  resolveConfigPath(input?: ResolveSpiderByteConfigPathInput): Promise<string>;
  validateConfigToml(input: ValidateSpiderByteConfigTomlInput): Promise<void>;
}

interface SpiderByteConfigCoreRpc {
  resolveConfigPath(input: ResolveSpiderByteConfigPathInput): string;
  validateConfigToml(input: ValidateSpiderByteConfigTomlInput): void;
}

class SpiderByteConfigCoreRpcImpl implements SpiderByteConfigCoreRpc {
  resolveConfigPath(input: ResolveSpiderByteConfigPathInput): string {
    return input.configPath ?? join(input.homeDir ?? join(homedir(), '.spiderbyte'), 'config.toml');
  }

  validateConfigToml(input: ValidateSpiderByteConfigTomlInput): void {
    try {
      parseToml(input.text);
    } catch (error) {
      const validationIssues = extractValidationIssues(error);
      if (validationIssues !== undefined) {
        throw toConfigValidationError(error, validationIssues);
      }
      throw error;
    }
  }
}

export class SpiderByteConfigRpcClient implements SpiderByteConfigRpc {
  private readonly core = new SpiderByteConfigCoreRpcImpl();

  async resolveConfigPath(input: ResolveSpiderByteConfigPathInput = {}): Promise<string> {
    return this.core.resolveConfigPath(input);
  }

  async validateConfigToml(input: ValidateSpiderByteConfigTomlInput): Promise<void> {
    this.core.validateConfigToml(input);
  }
}

export function createSpiderByteConfigRpc(): SpiderByteConfigRpc {
  return new SpiderByteConfigRpcClient();
}

function toConfigValidationError(
  error: unknown,
  validationIssues: readonly SpiderByteConfigValidationIssue[],
): SpiderByteError {
  const details =
    error instanceof SpiderByteError && error.details !== undefined
      ? { ...error.details, validationIssues }
      : { validationIssues };

  if (error instanceof SpiderByteError) {
    return new SpiderByteError(error.code, error.message, { details });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new SpiderByteError(ErrorCodes.CONFIG_INVALID, message, { details });
}

function extractValidationIssues(error: unknown): readonly SpiderByteConfigValidationIssue[] | undefined {
  const zodError = findZodError(error);
  if (zodError === undefined) return undefined;
  return zodError.issues.map((issue) => ({
    path: issue.path.map((segment) =>
      typeof segment === 'number' ? segment : String(segment),
    ),
    message: issue.message,
  }));
}

function findZodError(error: unknown): z.ZodError | undefined {
  if (error instanceof z.ZodError) return error;
  if (error instanceof Error && error.cause instanceof z.ZodError) return error.cause;
  return undefined;
}
