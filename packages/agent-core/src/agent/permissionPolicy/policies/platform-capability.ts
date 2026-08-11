/**
 * Bridges tool authorization to the workspace platform policy.
 *
 * Existing SpiderByte permission policies remain authoritative for interaction
 * details while the bridge is disabled. When `platform_services` is enabled,
 * the durable workspace policy becomes authoritative for governed capability
 * decisions; isolated legacy embeddings keep their existing behavior.
 */

import { IInstantiationService } from '#/_base/di/instantiation';
import { IFlagService } from '#/app/flag/flag';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import type { PolicyDecision } from '@spiderbyte/protocol';
import type {
  PermissionPolicy,
  PermissionPolicyContext,
  PermissionPolicyResult,
} from '#/agent/permissionPolicy/types';

const capabilityByTool = new Map<string, 'shell' | 'filesystem' | 'network' | 'connector' | 'model'>([
  ['Bash', 'shell'],
  ['Read', 'filesystem'],
  ['Write', 'filesystem'],
  ['Edit', 'filesystem'],
  ['Glob', 'filesystem'],
  ['Grep', 'filesystem'],
  ['ReadMediaFile', 'filesystem'],
  ['FetchURL', 'network'],
  ['WebSearch', 'network'],
  ['MCP', 'connector'],
  ['Agent', 'model'],
  ['AgentSwarm', 'model'],
]);

export class PlatformCapabilityPermissionPolicyService implements PermissionPolicy {
  readonly name = 'platform-capability';

  constructor(
    @IInstantiationService private readonly instantiation: IInstantiationService,
  ) {}

  async evaluate(context: PermissionPolicyContext): Promise<PermissionPolicyResult | undefined> {
    const capability = capabilityByTool.get(context.toolCall.name);
    if (capability === undefined) return undefined;
    // The legacy permission chain is also used by minimal embeddings and
    // focused tests that do not install the App-scoped flag service. Treat a
    // missing flag service as the feature being disabled; a fully bootstrapped
    // workspace still gets the authoritative platform bridge when opted in.
    const enabled = this.instantiation.invokeFunction((accessor) => {
      try {
        return accessor.get(IFlagService).enabled('platform_services');
      } catch {
        return false;
      }
    });
    if (!enabled) return undefined;

    const platform = this.instantiation.invokeFunction((accessor) =>
      accessor.get(IWorkspacePolicyService),
    );

    const requestId = `tool_${sanitize(context.toolCall.id)}_${sanitize(context.turnId)}`;
    const decision: PolicyDecision = await platform.evaluate({
      request_id: requestId,
      capability,
      action: context.execution.description ?? context.toolCall.name,
      requested_by: 'agent',
      metadata: { tool_name: context.toolCall.name },
    });

    if (decision.outcome === 'allow') return { kind: 'approve' };
    if (decision.outcome === 'deny') {
      return { kind: 'deny', message: decision.reason };
    }

    return {
      kind: 'ask',
      reason: { platform_decision_id: decision.id, platform_policy: decision.reason },
      resolveApproval: (response) => {
        if (response.decision === 'approved') {
          void platform.approve(decision.id, {
            request_id: `approval_${decision.id}`,
            decided_by: 'user',
          });
          return { kind: 'approve' };
        }
        void platform.deny(decision.id, {
          request_id: `denial_${decision.id}`,
          decided_by: 'user',
          reason: response.feedback ?? 'Capability request was denied by the user.',
        });
        return {
          kind: 'deny',
          message: response.feedback ?? 'Capability request was denied by the user.',
        };
      },
    };
  }
}

function sanitize(value: string | number): string {
  return String(value).replaceAll(/[^A-Za-z0-9._:-]/g, '_').slice(0, 120);
}
