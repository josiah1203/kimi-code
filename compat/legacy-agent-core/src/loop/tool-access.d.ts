export type ToolFileAccessOperation = 'read' | 'write' | 'readwrite' | 'search';
export interface ToolFileAccess {
    readonly kind: 'file';
    readonly operation: ToolFileAccessOperation;
    readonly path: string;
    readonly recursive?: boolean;
}
export interface ToolResourceAccessAll {
    /**
     * Arbitrary side effects or resources that cannot be represented as a
     * file access. This is intentionally operation-less and globally
     * exclusive for concurrency.
     */
    readonly kind: 'all';
}
export type ToolResourceAccess = ToolFileAccess | ToolResourceAccessAll;
export type ToolAccesses = readonly ToolResourceAccess[];
export declare const ToolAccesses: {
    none(): ToolAccesses;
    all(): ToolAccesses;
    file(operation: ToolFileAccessOperation, path: string, options?: {
        readonly recursive?: boolean;
    }): ToolAccesses;
    readFile(path: string): ToolAccesses;
    readTree(path: string): ToolAccesses;
    writeFile(path: string): ToolAccesses;
    writeTree(path: string): ToolAccesses;
    readWriteFile(path: string): ToolAccesses;
    readWriteTree(path: string): ToolAccesses;
    searchTree(path: string): ToolAccesses;
    conflict(left: ToolAccesses, right: ToolAccesses): boolean;
};
