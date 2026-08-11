/**
 * Cron-fire XML rendering — produces the chat-history injection text
 * the scheduler hands to the model when a CronTask fires.
 *
 * Output shape:
 *   <cron-fire jobId="..." cron="..." recurring="true|false" coalescedCount="N" stale="true|false">
 *   <prompt>
 *   verbatim user prompt
 *   </prompt>
 *   </cron-fire>
 *
 * Mirrors `agent/context/notification-xml.ts`: attribute values are
 * escape-safe via `stringAttr`, but the body inside `<prompt>` is
 * verbatim. The injection target is an LLM-visible transcript where
 * double-escaping would be noisier than literal punctuation.
 */
import type { CronJobOrigin } from '../../agent/context/types';
export declare function renderCronFireXml(origin: CronJobOrigin, prompt: string): string;
