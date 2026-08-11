import type { TelemetryClient, TelemetryContextPatch, TelemetryProperties } from '#/types';

export function withTelemetryContext(
  client: TelemetryClient,
  patch: TelemetryContextPatch,
): TelemetryClient {
  return client.withContext?.(patch) ?? {
    track: (event: string, properties?: TelemetryProperties) =>
      client.track(event, { ...patch, ...properties }),
    setContext: (next) => client.setContext?.({ ...patch, ...next }),
  };
}

export const noopTelemetryClient: TelemetryClient = {
  track: () => {},
  setContext: () => {},
  withContext: () => noopTelemetryClient,
  flush: () => {},
  flushSync: () => {},
  shutdown: () => {},
  setAppender: () => {},
  setEnabled: () => {},
};

