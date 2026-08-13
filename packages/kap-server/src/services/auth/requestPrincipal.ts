import { AsyncLocalStorage } from 'node:async_hooks';

import type { DelegatedPrincipal } from '@spiderbyte/protocol';

const requestPrincipalStorage = new AsyncLocalStorage<DelegatedPrincipal | undefined>();

/** Internal request property used to carry identity across WebSocket events. */
export const WEBSOCKET_REQUEST_PRINCIPAL = Symbol('spiderbyte.websocketPrincipal');
export type WebSocketRequestWithPrincipal = {
  readonly [WEBSOCKET_REQUEST_PRINCIPAL]?: DelegatedPrincipal;
};

/** Bind the verified principal to the current HTTP request execution context. */
export function setRequestDelegatedPrincipal(principal: DelegatedPrincipal | undefined): void {
  requestPrincipalStorage.enterWith(principal);
}

/** Read the principal established by the server auth boundary, if any. */
export function currentRequestDelegatedPrincipal(): DelegatedPrincipal | undefined {
  return requestPrincipalStorage.getStore();
}

/** Useful for tests and for connection handlers that need an explicit scope. */
export function runWithRequestDelegatedPrincipal<T>(
  principal: DelegatedPrincipal | undefined,
  callback: () => T,
): T {
  return requestPrincipalStorage.run(principal, callback);
}

export function attachWebSocketRequestDelegatedPrincipal(
  request: object,
  principal: DelegatedPrincipal | undefined,
): void {
  if (principal === undefined) return;
  Object.defineProperty(request, WEBSOCKET_REQUEST_PRINCIPAL, {
    configurable: false,
    enumerable: false,
    value: principal,
    writable: false,
  });
}

export function webSocketRequestDelegatedPrincipal(
  request: object,
): DelegatedPrincipal | undefined {
  return (request as WebSocketRequestWithPrincipal)[WEBSOCKET_REQUEST_PRINCIPAL];
}
