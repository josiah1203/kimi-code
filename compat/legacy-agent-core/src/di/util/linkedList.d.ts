/**
 * Doubly-linked list with O(1) `push` and removal via the disposer returned
 * from `push`. Used by `InstantiationService` to park `onDid*`/`onWill*`
 * event subscriptions made against a Proxy before the real service is
 * materialised — when the real instance is built, the list is drained and
 * each parked listener is rebound to the real event.
 *
 * Vendored verbatim from krow `packages/core/src/base/linkedList.ts`
 * (in turn the VSCode original).
 */
export declare class LinkedList<E> {
    private _first;
    private _last;
    private _size;
    get size(): number;
    isEmpty(): boolean;
    push(element: E): () => void;
    private _remove;
    [Symbol.iterator](): Iterator<E>;
}
