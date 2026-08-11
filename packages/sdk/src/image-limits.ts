import {
  MAX_IMAGE_EDGE_PX,
  READ_IMAGE_BYTE_BUDGET,
} from '@spiderbyte/agent-core';

export interface ImageConfig {
  readonly maxEdgePx?: number;
  readonly readByteBudget?: number;
}

/** Host-owned image limits used by prompt ingestion and media reads. */
export class ImageLimits {
  constructor(
    private readonly env: Readonly<Record<string, string | undefined>> = process.env,
    private config: ImageConfig | undefined = undefined,
  ) {}

  setConfig(config: ImageConfig | undefined): void {
    this.config = config;
  }

  maxEdgePx(): number {
    return this.config?.maxEdgePx ?? resolveMaxImageEdgePxFromEnv(this.env) ?? MAX_IMAGE_EDGE_PX;
  }

  readByteBudget(): number {
    return this.config?.readByteBudget ?? resolveReadImageByteBudgetFromEnv(this.env) ?? READ_IMAGE_BYTE_BUDGET;
  }
}

function resolveMaxImageEdgePxFromEnv(env: Readonly<Record<string, string | undefined>>): number | undefined {
  return positiveInt(env['SPIDERBYTE_IMAGE_MAX_EDGE_PX'] ?? env['SPIDERBYTE_IMAGE_MAX_EDGE_PX']);
}

function resolveReadImageByteBudgetFromEnv(env: Readonly<Record<string, string | undefined>>): number | undefined {
  return positiveInt(env['SPIDERBYTE_IMAGE_READ_BYTE_BUDGET'] ?? env['SPIDERBYTE_IMAGE_READ_BYTE_BUDGET']);
}

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
