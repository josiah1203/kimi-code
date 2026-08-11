/** Shared guard for platform metadata crossing a persistence or wire boundary. */

// Token usage counters are safe operational metadata; credential-bearing
// token fields remain blocked (including access/refresh tokens); opaque token
// references remain allowed. Keep the narrow plural exception explicit so a provider's
// usage projection can survive the same redaction guard as every other Run
// metadata field.
const sensitiveMetadataKey = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token(?!_ref|s(?:_|$))|password|private[_-]?key|authorization|credential(?![_-]?ref)|secret(?![_-]?ref)|cookie)/i;

export function findSensitivePlatformMetadataPath(
  value: unknown,
  path = 'metadata',
  seen = new WeakSet<object>(),
): string | undefined {
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    for (const [index, item] of value.entries()) {
      const found = findSensitivePlatformMetadataPath(item, `${path}[${index}]`, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (sensitiveMetadataKey.test(key)) return nextPath;
    const found = findSensitivePlatformMetadataPath(nested, nextPath, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}
