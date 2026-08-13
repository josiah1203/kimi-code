'use client';

import {
  commercialSessionResponseSchema,
  type CommercialSessionResponse,
} from '@spiderbyte/protocol';

export async function fetchCommercialSession(): Promise<CommercialSessionResponse | undefined> {
  try {
    const response = await fetch('/api/commercial/session', { cache: 'no-store' });
    if (!response.ok) return undefined;
    const parsed = commercialSessionResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
