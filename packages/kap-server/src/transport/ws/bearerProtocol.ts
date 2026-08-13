/**
 * WebSocket bearer-token subprotocol helpers.
 */

export const WS_BEARER_PROTOCOL_PREFIX = 'spiderbyte.bearer.';
export const WS_DELEGATED_PRINCIPAL_PROTOCOL_PREFIX = 'spiderbyte.identity.';

export function extractWsBearerToken(protocolHeader: string | undefined): string | null {
  if (protocolHeader === undefined) {
    return null;
  }
  for (const entry of protocolHeader.split(',')) {
    const protocol = entry.trim();
    if (protocol.startsWith(WS_BEARER_PROTOCOL_PREFIX)) {
      const token = protocol.slice(WS_BEARER_PROTOCOL_PREFIX.length);
      return token.length === 0 ? null : token;
    }
  }
  return null;
}

export function extractWsDelegatedPrincipalAssertion(protocolHeader: string | undefined): string | null {
  if (protocolHeader === undefined) return null;
  for (const entry of protocolHeader.split(',')) {
    const protocol = entry.trim();
    if (protocol.startsWith(WS_DELEGATED_PRINCIPAL_PROTOCOL_PREFIX)) {
      const assertion = protocol.slice(WS_DELEGATED_PRINCIPAL_PROTOCOL_PREFIX.length);
      return assertion.length === 0 ? null : assertion;
    }
  }
  return null;
}

export function selectWsBearerProtocol(protocols: Iterable<string>): string | false {
  for (const protocol of protocols) {
    if (protocol.startsWith(WS_BEARER_PROTOCOL_PREFIX)) {
      return protocol;
    }
  }
  for (const protocol of protocols) {
    if (protocol.startsWith(WS_DELEGATED_PRINCIPAL_PROTOCOL_PREFIX)) return protocol;
  }
  return false;
}
