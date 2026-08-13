import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

export interface RunOrchestrationParams {
  readonly request_id: string;
  readonly run_id: string;
  readonly attempt_id: string;
  readonly organization_id: string;
  readonly workspace_id: string;
  readonly execution_target_id: string;
  readonly provider_connection_id?: string;
}

interface DispatchQueueBinding {
  send(body: Readonly<Record<string, unknown>>, options?: { readonly contentType?: 'json' }): Promise<unknown>;
}

interface WorkflowEnvironment {
  readonly DISPATCH_QUEUE: DispatchQueueBinding;
}

export class RunOrchestrationWorkflow extends WorkflowEntrypoint<WorkflowEnvironment, RunOrchestrationParams> {
  override async run(event: WorkflowEvent<RunOrchestrationParams>, step: WorkflowStep): Promise<Readonly<Record<string, string>>> {
    const payload = event.payload;
    const result = await step.do('enqueue provider-neutral dispatch intent', {
      retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' },
    }, async () => {
      await this.env.DISPATCH_QUEUE.send({
        kind: 'run.dispatch.requested',
        workflow_instance_id: event.instanceId,
        request_id: payload.request_id,
        run_id: payload.run_id,
        attempt_id: payload.attempt_id,
        organization_id: payload.organization_id,
        workspace_id: payload.workspace_id,
        execution_target_id: payload.execution_target_id,
        provider_connection_id: payload.provider_connection_id,
      }, { contentType: 'json' });
      return { state: 'dispatch_queued', workflow_instance_id: event.instanceId };
    });
    return result;
  }
}
