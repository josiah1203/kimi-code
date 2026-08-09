import { describe, expect, it } from 'vitest';

import { platformCommandAcceptedSchema, runSchema } from '../src/index.js';
import {
  platformCommandAcceptedSchema as protocolCommandAcceptedSchema,
  runSchema as protocolRunSchema,
} from '@moonshot-ai/protocol';

describe('Node SDK platform contract exports', () => {
  it('re-export the canonical protocol schema instances', () => {
    expect(runSchema).toBe(protocolRunSchema);
    expect(platformCommandAcceptedSchema).toBe(protocolCommandAcceptedSchema);
  });

  it('validates a durable command acknowledgement', () => {
    expect(
      platformCommandAcceptedSchema.parse({
        request_id: 'request_01',
        object_type: 'run',
        object_id: 'run_01',
      }),
    ).toEqual({
      request_id: 'request_01',
      object_type: 'run',
      object_id: 'run_01',
    });
  });
});
