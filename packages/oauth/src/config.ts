/**
 * Provider-neutral configuration shapes used by the OAuth and model-catalog
 * helpers.  These types deliberately describe local configuration only; they
 * do not encode a hosted account, entitlement, billing, or tenancy model.
 */

export interface ProviderOAuthRef {
  readonly key: string;
  readonly oauthHost?: string | undefined;
}

export interface ProviderModelAlias {
  readonly provider: string;
  readonly model: string;
  readonly maxContextSize: number;
  readonly capabilities?: readonly string[] | undefined;
  readonly displayName?: string | undefined;
  readonly protocol?: string | undefined;
  readonly betaApi?: boolean | undefined;
  readonly adaptiveThinking?: boolean | undefined;
  readonly supportEfforts?: readonly string[] | undefined;
  readonly defaultEffort?: string | undefined;
  readonly overrides?: Record<string, unknown> | undefined;
  readonly [key: string]: unknown;
}

export interface ProviderModelInfo {
  readonly id: string;
  readonly contextLength: number;
  readonly supportsReasoning?: boolean | undefined;
  readonly supportsImageIn?: boolean | undefined;
  readonly supportsVideoIn?: boolean | undefined;
  readonly supportsToolUse?: boolean | undefined;
  readonly supportsThinkingType?: 'no' | 'both' | 'only' | undefined;
  readonly supportEfforts?: readonly string[] | undefined;
  readonly defaultEffort?: string | undefined;
  readonly displayName?: string | undefined;
}

export interface ProviderConfigShape {
  readonly type?: string | undefined;
  readonly baseUrl?: string | undefined;
  /** Opaque reference to credential material; raw apiKey is runtime-only. */
  readonly secretRef?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly oauth?: ProviderOAuthRef | undefined;
  readonly source?: unknown;
  readonly env?: unknown;
  readonly [key: string]: unknown;
}

export interface SpiderByteConfigShape {
  providers: Record<string, ProviderConfigShape>;
  models?: Record<string, ProviderModelAlias>;
  defaultModel?: string | undefined;
  defaultProvider?: string | undefined;
  thinking?: {
    readonly enabled?: boolean | undefined;
    readonly effort?: string | undefined;
    readonly [key: string]: unknown;
  } | undefined;
  services?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}
