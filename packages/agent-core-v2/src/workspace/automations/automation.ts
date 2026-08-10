/** Workspace automation definitions and fire commands. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  Automation,
  AutomationCreateInput,
  AutomationFireInput,
  AutomationFireResult,
  AutomationUpdateInput,
} from '@moonshot-ai/protocol';

export interface WorkspaceAutomationsChangedEvent {
  readonly automation: Automation;
  readonly kind: 'created' | 'updated' | 'fired';
  readonly fire?: AutomationFireResult;
}

export interface IWorkspaceAutomationService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceAutomationsChangedEvent>;
  list(): Promise<readonly Automation[]>;
  get(id: string): Promise<Automation | undefined>;
  history(automationId?: string): Promise<readonly AutomationFireResult[]>;
  create(input: AutomationCreateInput): Promise<Automation>;
  update(id: string, input: AutomationUpdateInput): Promise<Automation | undefined>;
  fire(id: string, input: AutomationFireInput): Promise<AutomationFireResult>;
  /** Fire enabled cron definitions whose durable next_run_at is due. */
  fireDue(now?: Date): Promise<readonly AutomationFireResult[]>;
}

export const IWorkspaceAutomationService: ServiceIdentifier<IWorkspaceAutomationService> =
  createDecorator<IWorkspaceAutomationService>('automationService');
