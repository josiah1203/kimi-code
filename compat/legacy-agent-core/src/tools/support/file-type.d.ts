/**
 * file-type — magic-byte + extension detection. No npm dependency.
 */
export declare const MEDIA_SNIFF_BYTES = 512;
export interface FileType {
    readonly kind: 'text' | 'image' | 'video' | 'unknown';
    readonly mimeType: string;
}
export type DetectFileTypeMode = 'text' | 'media';
export declare const IMAGE_MIME_BY_SUFFIX: Readonly<Record<string, string>>;
export declare const VIDEO_MIME_BY_SUFFIX: Readonly<Record<string, string>>;
export declare const NON_TEXT_SUFFIXES: ReadonlySet<string>;
export declare function sniffMediaFromMagic(data: Buffer | Uint8Array): FileType | null;
export interface ImageDimensions {
    readonly width: number;
    readonly height: number;
    /**
     * Present (true) when a JPEG EXIF orientation of 5-8 swapped the reported
     * width/height into display space.
     */
    readonly transposed?: boolean;
}
/**
 * Best-effort pixel-dimension reader for common raster formats.
 *
 * Inspects only the fixed region near the start of the file where each
 * format records its dimensions (the IHDR/DIB header, the RIFF chunk
 * after the `WEBP` tag, or the first JPEG SOFn segment). Returns `null`
 * for formats whose dimensions are not locatable from that region, or
 * when the supplied buffer is too short to cover it.
 *
 * JPEG dimensions are reported in DISPLAY space: an EXIF Orientation of
 * 5-8 transposes the image at decode time, so the SOF width/height are
 * swapped to match what decoders (and this codebase's crop regions and
 * compression captions) actually operate in.
 */
export declare function sniffImageDimensions(data: Buffer | Uint8Array): ImageDimensions | null;
export declare function detectFileType(path: string, header?: Buffer | Uint8Array, type?: DetectFileTypeMode): FileType;
