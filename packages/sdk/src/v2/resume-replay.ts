import { readFile } from 'node:fs/promises';

import {
  reduceContextTranscript,
  type AgentReplayRecord,
  type WireRecord,
} from '@spiderbyte/agent-core';

export interface FoldedAgentReplay {
  readonly replay: readonly AgentReplayRecord[];
  readonly toolStore: Readonly<Record<string, unknown>>;
}

/** Keep the most recent user-turn window without changing record order. */
export function limitAgentReplayByTurns<T extends { readonly type: string; readonly message?: unknown }>(
  records: readonly T[],
  maxTurns?: number,
): readonly T[] {
  if (maxTurns === undefined) return records;
  if (maxTurns <= 0) return [];
  const starts = records.flatMap((record, index) => {
    if (record.type !== 'message' || typeof record.message !== 'object' || record.message === null) {
      return [];
    }
    return (record.message as { readonly role?: unknown }).role === 'user' ? [index] : [];
  });
  if (starts.length <= maxTurns) return records;
  return records.slice(starts[starts.length - maxTurns]);
}

const EMPTY_FOLD: FoldedAgentReplay = { replay: [], toolStore: {} };

/** Rebuild the supported read-only replay view from the canonical v2 journal. */
export async function foldAgentWireReplay(wirePath: string): Promise<FoldedAgentReplay> {
  try {
    const records = parseWireRecords(await readFile(wirePath, 'utf8'));
    const transcript = reduceContextTranscript(records);
    const replay: AgentReplayRecord[] = transcript.entries.map((message, index) => ({
      type: 'message' as const,
      message,
      time: transcript.times[index] ?? 0,
    }));
    for (const record of records) {
      const time = record.time ?? 0;
      switch (record.type) {
        case 'permission.set_mode':
          replay.push({ type: 'permission_updated', mode: record['mode'] as never, time });
          break;
        case 'plan_mode.enter':
          replay.push({ type: 'plan_updated', enabled: true, time });
          break;
        case 'plan_mode.cancel':
        case 'plan_mode.exit':
          replay.push({ type: 'plan_updated', enabled: false, time });
          break;
        case 'config.update':
          replay.push({
            type: 'config_updated',
            config: stripWireEnvelope(record) as never,
            time,
          });
          break;
        case 'permission.record_approval_result':
          replay.push({ type: 'approval_result', record: stripWireEnvelope(record) as never, time });
          break;
        default:
          break;
      }
    }
    replay.sort((a, b) => a.time - b.time);
    const toolStore: Record<string, unknown> = {};
    for (const record of records) {
      if (record.type !== 'tools.update_store' || typeof record['key'] !== 'string') continue;
      toolStore[record['key']] = record['value'];
    }
    return { replay, toolStore };
  } catch {
    return EMPTY_FOLD;
  }
}

function stripWireEnvelope(record: WireRecord): Record<string, unknown> {
  const { type: _type, time: _time, ...payload } = record;
  return payload;
}

function parseWireRecords(content: string): WireRecord[] {
  const lines = content.split('\n');
  const records: WireRecord[] = [];
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim().length === 0) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as { type?: unknown }).type === 'string'
      ) {
        records.push(value as WireRecord);
      }
    } catch (error) {
      if (index === lines.length - 1) break;
      throw error;
    }
  }
  return records;
}
