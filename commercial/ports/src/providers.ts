import type {
  AccountId,
  CapabilityStatus,
  OrganizationId,
  UserId,
  WorkspaceId,
} from '@spiderbyte/commercial-domain';

import type { CapabilityAdapter } from './platform';
import type { SecretsProvider } from './hosted';

export type LLMMessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** Provider-neutral message content. Provider-specific parts remain opaque to domain code. */
export type LLMMessageContent = string | readonly Readonly<Record<string, unknown>>[];

export interface LLMMessage {
  readonly role: LLMMessageRole;
  readonly content: LLMMessageContent;
  readonly name?: string;
  readonly tool_call_id?: string;
}

export interface LLMRequestContext {
  readonly account_id: AccountId;
  readonly organization_id: OrganizationId;
  readonly user_id?: UserId;
  readonly workspace_id?: WorkspaceId;
  readonly project_id?: string;
  readonly run_id?: string;
  readonly attempt_id?: string;
  readonly plan: string;
}

export interface LLMRequest {
  readonly request_id: string;
  readonly idempotency_key: string;
  readonly context: LLMRequestContext;
  readonly model: string;
  readonly fallback_models?: readonly string[];
  readonly provider?: Readonly<Record<string, unknown>>;
  readonly messages: readonly LLMMessage[];
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly timeout_ms?: number;
  readonly signal?: AbortSignal;
}

export interface LLMUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cached_tokens: number;
  readonly total_tokens: number;
  /** Provider-reported cost; never authoritative for SpiderByte billing. */
  readonly provider_cost?: {
    readonly currency: string;
    readonly amount: number;
  };
}

export interface LLMCostEstimate {
  readonly currency: string;
  readonly amount: number;
  readonly price_book_id?: string;
}

export interface LLMCompletion {
  readonly request_id: string;
  readonly provider: string;
  readonly model: string;
  readonly provider_request_id?: string;
  readonly generation_id?: string;
  readonly text: string;
  readonly finish_reason?: string;
  readonly usage: LLMUsage;
  readonly estimated_cost?: LLMCostEstimate;
  readonly provider_metadata?: Readonly<Record<string, unknown>>;
  /** Captured provider JSON for reconciliation/audit; callers must not expose it directly. */
  readonly provider_response?: Readonly<Record<string, unknown>>;
}

export type LLMStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'completed'; readonly completion: LLMCompletion }
  | { readonly type: 'error'; readonly error: { readonly code: string; readonly message: string } };

export interface LLMProvider extends CapabilityAdapter {
  readonly provider_name: string;
  complete(input: LLMRequest): Promise<LLMCompletion>;
  stream(input: LLMRequest): AsyncIterable<LLMStreamEvent>;
  /** Providers may omit this when the upstream has no cancellation endpoint. */
  cancel?(requestId: string): Promise<void>;
}

/** Configuration boundary for a provider that resolves credentials server-side. */
export interface LLMProviderFactoryOptions {
  readonly secrets?: SecretsProvider;
  readonly secret_ref?: string;
  readonly api_key?: string;
}

export type LLMProviderCapability = CapabilityStatus;
