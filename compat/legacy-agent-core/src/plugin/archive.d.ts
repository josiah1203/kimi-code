export declare function downloadZip(url: string, signal?: AbortSignal): Promise<Buffer>;
export declare function extractZip(buffer: Buffer, destDir: string): Promise<string>;
