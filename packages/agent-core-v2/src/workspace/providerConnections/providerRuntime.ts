/**
 * `providerConnections` domain — workspace-scoped execution against a
 * connection's real provider endpoint.
 *
 * Resolves opaque credentials only while constructing a `kosong` requester,
 * reuses Kimi's protocol adapter registry for wire calls and usage events, and
 * never returns credential material in validation or discovery results.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type {
  ModelRequestEvent,
  ModelRequestInput,
  ModelRequestParams,
} from '#/kosong/model/modelRequester';
import type { ModelCapability } from '#/kosong/contract/capability';
import type { Protocol, ProtocolProviderOptions } from '#/kosong/protocol/protocol';
import type { TokenUsage } from '#/kosong/contract/usage';
import type {
  ProviderConnection,
  ProviderConnectionCommandInput,
  ProviderConnectionCreateWithSecretInput,
  ProviderConnectionUpdateWithSecretInput,
  ProviderModelDiscovery,
  ProviderSecretRef,
  PlatformActor,
} from '@moonshot-ai/protocol';

export interface ProviderRuntimeValidationResult {
  readonly connection_id: string;
  readonly model: string;
  readonly ok: boolean;
  readonly duration_ms: number;
  readonly text?: string;
  readonly usage?: TokenUsage;
  readonly policy_decision_id?: string;
  readonly error?: string;
}

export interface ProviderRuntimeOperationOptions {
  readonly request_id?: string;
  readonly run_id?: string;
  readonly policy_decision_id?: string;
  readonly actor?: PlatformActor;
  readonly signal?: AbortSignal;
}

export interface ProviderRuntimeRequest {
  readonly request_id?: string;
  readonly run_id?: string;
  readonly policy_decision_id?: string;
  readonly actor?: PlatformActor;
  readonly model?: string;
  /** Ordered connection ids tried only when the preceding provider fails before emitting output. */
  readonly fallback_connection_ids?: readonly string[];
  readonly retry_count?: number;
  readonly retry_backoff_ms?: number;
  readonly input: ModelRequestInput;
  readonly params?: ModelRequestParams;
  readonly signal?: AbortSignal;
}

/**
 * Secret-free model metadata used by an agent-local platform binding.
 * Credential material and auth closures stay inside the provider runtime.
 */
export interface ProviderRuntimeModel {
  readonly connection_id: string;
  readonly provider: string;
  readonly model: string;
  readonly protocol: Protocol;
  readonly provider_type: string;
  readonly base_url?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly capabilities: ModelCapability;
  readonly max_context_size: number;
  readonly max_input_size?: number;
  readonly max_output_size?: number;
  readonly support_efforts?: readonly string[];
  readonly default_effort?: string;
  readonly provider_options?: ProtocolProviderOptions;
}

export interface ProviderRuntimeDiscoveryOptions {
  readonly force_remote?: boolean;
}

export interface IWorkspaceProviderRuntimeService {
  readonly _serviceBrand: undefined;

  createConnection(input: ProviderConnectionCreateWithSecretInput): Promise<ProviderConnection>;
  updateConnectionSecret(
    connectionId: string,
    input: ProviderConnectionUpdateWithSecretInput,
  ): Promise<ProviderConnection | undefined>;
  revokeConnection(
    connectionId: string,
    input: ProviderConnectionCommandInput,
  ): Promise<ProviderConnection | undefined>;

  validate(
    connectionId: string,
    model?: string,
    options?: ProviderRuntimeOperationOptions,
  ): Promise<ProviderRuntimeValidationResult>;
  discoverModels(
    connectionId: string,
    options?: ProviderRuntimeDiscoveryOptions & ProviderRuntimeOperationOptions,
  ): Promise<ProviderModelDiscovery>;
  describe(
    connectionId: string,
    model?: string,
  ): Promise<ProviderRuntimeModel>;
  request(
    connectionId: string,
    request: ProviderRuntimeRequest,
  ): Promise<AsyncIterable<ModelRequestEvent>>;
  /** Returns the opaque secret reference without resolving secret material. */
  secretReference(connectionId: string): Promise<ProviderSecretRef | undefined>;
}

export const IWorkspaceProviderRuntimeService: ServiceIdentifier<IWorkspaceProviderRuntimeService> =
  createDecorator<IWorkspaceProviderRuntimeService>('providerRuntimeService');
