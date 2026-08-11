/** Map workspace platform domain errors to stable, non-sensitive wire errors. */

import { ErrorCodes, isError2 } from '@spiderbyte/agent-core';

import { errEnvelope, type Envelope } from '../../protocol/envelope';
import { ErrorCode } from '../../protocol/error-codes';

type ProtocolErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function mapPlatformError(error: unknown, requestId: string): Envelope<null> {
  if (!isError2(error)) {
    return errEnvelope(ErrorCode.INTERNAL_ERROR, 'platform request failed', requestId);
  }

  const domainCode = String(error.code);
  const code = platformProtocolErrorCode(domainCode);
  return errEnvelope(code, platformProtocolErrorMessage(domainCode), requestId);
}

export function platformProtocolErrorCode(domainCode: string): ProtocolErrorCode {
  if (domainCode === 'request.invalid' || domainCode.endsWith('.invalid')) return ErrorCode.PLATFORM_STATE_INVALID;
  if (domainCode.startsWith('provider_runtime.')) {
    if (domainCode.endsWith('.connection_not_found')) return ErrorCode.PLATFORM_RESOURCE_NOT_FOUND;
    if (domainCode.endsWith('.policy_denied')) return ErrorCode.PLATFORM_POLICY_DENIED;
    if (domainCode.endsWith('.policy_required')) return ErrorCode.PLATFORM_APPROVAL_REQUIRED;
    if (domainCode.endsWith('.secret_missing')) return ErrorCode.PLATFORM_SECRET_INVALID;
    return ErrorCode.PLATFORM_STATE_INVALID;
  }
  if (domainCode === ErrorCodes.WORKSPACE_NOT_FOUND) return ErrorCode.WORKSPACE_NOT_FOUND;
  if (domainCode === ErrorCodes.AUTHORIZATION_DENIED) return ErrorCode.PLATFORM_POLICY_DENIED;
  if (domainCode === ErrorCodes.SESSION_NOT_FOUND || domainCode.endsWith('.session_not_found')) {
    return ErrorCode.SESSION_NOT_FOUND;
  }
  if (domainCode.startsWith('storage.')) return ErrorCode.PERSISTENCE_FAILURE;
  if (domainCode.endsWith('.not_found')) return ErrorCode.PLATFORM_RESOURCE_NOT_FOUND;
  if (
    domainCode.endsWith('.name_taken') ||
    domainCode.endsWith('.lease_busy') ||
    domainCode.endsWith('.already_exists') ||
    domainCode.endsWith('.request_reused')
  ) {
    return ErrorCode.PLATFORM_CONFLICT;
  }
  if (domainCode.endsWith('.policy_denied') || domainCode.endsWith('.membership_denied')) {
    return ErrorCode.PLATFORM_POLICY_DENIED;
  }
  if (domainCode.endsWith('.policy_required') || domainCode.endsWith('.approval_required')) {
    return ErrorCode.PLATFORM_APPROVAL_REQUIRED;
  }
  if (
    domainCode.endsWith('.secret_material') ||
    domainCode.endsWith('.credential_invalid')
  ) {
    return ErrorCode.PLATFORM_SECRET_INVALID;
  }
  if (
    domainCode.endsWith('.invalid_state') ||
    domainCode.endsWith('.invalid_input') ||
    domainCode.endsWith('.cycle') ||
    domainCode.endsWith('.execution_failed') ||
    domainCode.endsWith('.target_unavailable') ||
    domainCode.endsWith('.worker_request_failed') ||
    domainCode.endsWith('.worker_invalid_response') ||
    domainCode.endsWith('.executor_unavailable') ||
    domainCode.endsWith('.artifact_invalid') ||
    domainCode.endsWith('.lineage_invalid') ||
    domainCode.endsWith('.invalid_schedule') ||
    domainCode.endsWith('.usage_invalid') ||
    domainCode.endsWith('.missing_hash') ||
    domainCode.endsWith('.invalid_content') ||
    domainCode.endsWith('.expired') ||
    domainCode.endsWith('.owner_required') ||
    domainCode.endsWith('.entitlement_disabled') ||
    domainCode.endsWith('.entitlement_exceeded') ||
    domainCode.endsWith('.lease_not_found')
  ) {
    return ErrorCode.PLATFORM_STATE_INVALID;
  }
  return ErrorCode.INTERNAL_ERROR;
}

export function platformProtocolErrorMessage(domainCode: string): string {
  if (domainCode === ErrorCodes.WORKSPACE_NOT_FOUND) return 'workspace not found';
  if (domainCode === ErrorCodes.AUTHORIZATION_DENIED) return 'platform policy denied the request';
  if (domainCode.startsWith('provider_runtime.')) {
    if (domainCode.endsWith('.connection_not_found')) return 'provider connection not found';
    if (domainCode.endsWith('.policy_denied')) return 'platform policy denied the provider request';
    if (domainCode.endsWith('.policy_required')) return 'platform policy approval is required for the provider request';
    if (domainCode.endsWith('.secret_missing')) return 'provider credential is unavailable';
    return 'provider request failed';
  }
  if (domainCode === ErrorCodes.SESSION_NOT_FOUND || domainCode.endsWith('.session_not_found')) {
    return 'session not found';
  }
  if (domainCode.endsWith('.not_found')) return 'platform resource not found';
  if (
    domainCode.endsWith('.name_taken') ||
    domainCode.endsWith('.lease_busy') ||
    domainCode.endsWith('.already_exists')
  ) {
    return 'platform resource conflicts with existing state';
  }
  if (domainCode.endsWith('.request_reused')) {
    return 'request id was already used with different request data';
  }
  if (domainCode.endsWith('.policy_denied') || domainCode.endsWith('.membership_denied')) {
    return 'platform policy denied the request';
  }
  if (domainCode.endsWith('.policy_required') || domainCode.endsWith('.approval_required')) {
    return 'platform policy approval is required before execution';
  }
  if (domainCode.endsWith('.secret_material') || domainCode.endsWith('.credential_invalid')) {
    return 'secret material must be represented by an opaque reference';
  }
  if (domainCode.startsWith('storage.')) return 'platform persistence failed';
  if (domainCode.endsWith('.invalid_state') || domainCode.endsWith('.invalid')) return 'platform request is invalid';
  if (domainCode.endsWith('.invalid_input')) return 'platform request contains invalid ML input';
  if (domainCode.endsWith('.executor_unavailable')) return 'requested ML execution target is unavailable';
  if (domainCode.endsWith('.execution_failed')) return 'pipeline execution is unavailable or failed';
  if (domainCode.endsWith('.target_unavailable')) return 'execution target is unavailable';
  if (domainCode.endsWith('.worker_request_failed')) return 'execution worker request failed';
  if (domainCode.endsWith('.worker_invalid_response')) return 'execution worker returned an invalid response';
  if (domainCode.endsWith('.artifact_invalid')) return 'ML artifact is invalid or unavailable';
  if (domainCode.endsWith('.lineage_invalid')) return 'ML lineage is invalid';
  if (domainCode.endsWith('.invalid_schedule')) return 'automation schedule is invalid';
  if (domainCode.endsWith('.usage_invalid')) return 'usage record is invalid';
  if (domainCode.endsWith('.missing_hash')) return 'artifact content hash is missing';
  if (domainCode.endsWith('.invalid_content')) return 'artifact content is invalid';
  if (domainCode.endsWith('.expired')) return 'artifact has expired';
  if (domainCode.endsWith('.owner_required')) return 'workspace ownership is required';
  if (domainCode.endsWith('.entitlement_disabled')) return 'usage limit is disabled';
  if (domainCode.endsWith('.entitlement_exceeded')) return 'usage limit exceeded';
  if (domainCode.endsWith('.lease_not_found')) return 'execution target lease not found';
  return 'platform request failed';
}
