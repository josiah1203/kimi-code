/**
 * Shrink oversized images before they reach the model.
 *
 * A multimodal request carries each image as a base64 data URL; an unbounded
 * screenshot or photo wastes context tokens and can blow past the provider's
 * per-image byte ceiling. This module downsamples and re-encodes such images
 * so they fit a pixel + byte budget, while leaving already-small images
 * untouched — the common case is a fast, codec-free pass-through.
 *
 * Design notes:
 *  - Pure JS (jimp + a wasm WebP decoder), imported lazily so the codecs are
 *    only paid for when an image actually needs work; startup and the fast
 *    path stay cheap.
 *  - Best effort: any decode/encode failure returns the original bytes
 *    unchanged (`changed: false`). Callers must verify that this unchanged
 *    result satisfies their delivery limits before forwarding it.
 *  - PNG, JPEG, and (non-animated) WebP are re-encoded; WebP re-encodes
 *    through the PNG/JPEG ladder, so only its decoder wasm ships. GIF and
 *    animated WebP are passed through to preserve animation. Formats outside
 *    the provider-accepted set (see ./image-format-policy) are never
 *    forwarded by the part-level helpers — they are replaced with a text
 *    notice; the byte-level helpers still pass anything they cannot
 *    re-encode through unchanged, so callers must gate on
 *    `isModelAcceptedImageMime` first.
 *  - Compression must never be silent to the model: results carry the
 *    original dimensions, {@link buildImageCompressionCaption} renders the
 *    shared "what was compressed, where is the original" note every ingestion
 *    point can place next to the image, and {@link cropImageForModel} lets a
 *    caller read a region of the original back at full fidelity. In user
 *    prompts the context layer later reroutes that note through the hidden
 *    system-reminder injection via {@link extractImageCompressionCaptions},
 *    so its raw `<system>` markup never renders in the UI.
 */
import type { ContentPart } from '@spiderbyte/kosong';
import type { TelemetryClient } from '#/telemetry';
/**
 * Built-in longest-edge ceiling (px). Larger images are scaled down to fit.
 * This is the default only: the effective ceiling is resolved per call by
 * {@link resolveMaxImageEdgePx} (explicit option > env > config > this).
 */
export declare const MAX_IMAGE_EDGE_PX = 2000;
/**
 * Env var overriding the longest-edge ceiling (px). Read live on every
 * resolution so it applies in any process without wiring; a value that is
 * not a positive integer is ignored.
 */
export declare const MAX_IMAGE_EDGE_ENV = "KIMI_IMAGE_MAX_EDGE_PX";
/** The env override for the longest-edge ceiling, or undefined when unset/invalid. */
export declare function maxImageEdgeFromEnv(env?: Readonly<Record<string, string | undefined>>): number | undefined;
/**
 * Default longest-edge ceiling (px) for calls that pass no explicit
 * `maxEdge` and have no config owner: env var > built-in
 * {@link MAX_IMAGE_EDGE_PX}. Owned call sites (tools under an Agent, server
 * ingestion under a core) resolve through their `ImageLimits` instance
 * instead, which adds the owner's `[image]` config between the two.
 */
export declare function resolveMaxImageEdgePx(env?: Readonly<Record<string, string | undefined>>): number;
/**
 * Raw-byte budget for a single image. base64 inflates bytes by ~4/3, so a
 * 3.75 MB raw payload stays under a 5 MB encoded ceiling. Tune to the active
 * provider's per-image limit.
 */
export declare const IMAGE_BYTE_BUDGET: number;
/**
 * Built-in raw-byte budget for images the model reads for itself
 * (ReadMediaFile's default path). Far below {@link IMAGE_BYTE_BUDGET}: a
 * session that keeps screenshotting and reading images accumulates every one
 * of them in the request body on every turn, so per-image size — not the
 * provider's per-image ceiling — is what keeps the total under the
 * provider's request-size limit. 256 KB keeps a clean 2000px UI screenshot
 * on the lossless fast path while capping dense content at a readable
 * q80/1000px JPEG; fine detail stays reachable through the `region`
 * readback, which deliberately ignores this budget.
 */
export declare const READ_IMAGE_BYTE_BUDGET: number;
/**
 * Env var overriding the read-image byte budget. Read live on every
 * resolution; a value that is not a positive integer is ignored.
 */
export declare const READ_IMAGE_BYTE_BUDGET_ENV = "KIMI_IMAGE_READ_BYTE_BUDGET";
/** The env override for the read-image byte budget, or undefined when unset/invalid. */
export declare function readImageByteBudgetFromEnv(env?: Readonly<Record<string, string | undefined>>): number | undefined;
/**
 * Read-image byte budget for callers with no config owner; see
 * {@link resolveMaxImageEdgePx} for the ownership model.
 */
export declare function resolveReadImageByteBudget(env?: Readonly<Record<string, string | undefined>>): number;
/**
 * Raw-byte ceiling above which compression is skipped rather than decoded. The
 * byte budget bounds the *output*, but the compressor still has to load the
 * *input* first: a huge base64 payload (e.g. an oversized or invalid image from
 * an MCP tool) would be `Buffer.from`-decoded — and possibly handed to Jimp —
 * before any downstream cap (like the 10 MB MCP per-part limit) can drop it.
 * This bounds that input allocation. Set well above legitimate
 * screenshots/photos; larger images pass through uncompressed.
 */
export declare const MAX_IMAGE_DECODE_BYTES: number;
export interface CompressImageOptions {
    /**
     * Override the longest-edge ceiling (px). When omitted, owned call sites
     * pass their {@link ImageLimits.maxEdgePx}; ownerless ones fall back to
     * {@link resolveMaxImageEdgePx} (env var, then built-in).
     */
    readonly maxEdge?: number;
    /** Override the raw-byte budget. */
    readonly byteBudget?: number;
    /** Override the raw-byte ceiling above which compression is skipped. */
    readonly maxDecodeBytes?: number;
    /**
     * Report an `image_compress` event per compression call (and an
     * `image_crop` event per {@link cropImageForModel} call). Absent → silent.
     */
    readonly telemetry?: ImageCompressionTelemetry;
}
/** Wiring for the optional compression telemetry events. */
export interface ImageCompressionTelemetry {
    readonly client: TelemetryClient;
    /** Where the image entered the pipeline, e.g. 'read_media', 'tui_paste'. */
    readonly source: string;
}
export interface CompressImageResult {
    /** Bytes to send: the re-encoded image, or the original when unchanged. */
    readonly data: Uint8Array;
    /** MIME of `data`. May differ from the input (e.g. png → jpeg). */
    readonly mimeType: string;
    /** Pixel width of `data`; falls back to the input size when unknown. */
    readonly width: number;
    /** Pixel height of `data`; falls back to the input size when unknown. */
    readonly height: number;
    /**
     * Pixel width of the input image, in display space (EXIF orientation
     * applied): the decoded width when re-encoded, the header sniff on
     * passthrough (0 when it cannot be determined).
     */
    readonly originalWidth: number;
    /** Pixel height of the input image; see {@link originalWidth}. */
    readonly originalHeight: number;
    /** True only when `data` differs from the input bytes. */
    readonly changed: boolean;
    readonly originalByteLength: number;
    readonly finalByteLength: number;
}
/**
 * Downsample/re-encode `bytes` to fit the pixel + byte budget.
 *
 * Never throws: on any failure (unsupported format, decode error, a result
 * that would be larger than the input) the original bytes are returned with
 * `changed: false`.
 */
export declare function compressImageForModel(bytes: Uint8Array, mimeType: string, options?: CompressImageOptions): Promise<CompressImageResult>;
export interface CompressBase64Result {
    readonly base64: string;
    readonly mimeType: string;
    /** Pixel width of the (possibly re-encoded) payload; 0 when unknown. */
    readonly width: number;
    /** Pixel height of the (possibly re-encoded) payload; 0 when unknown. */
    readonly height: number;
    /**
     * Pixel width of the input image, in display space (EXIF orientation
     * applied): the decoded width when re-encoded, the header sniff on
     * passthrough (0 when it cannot be determined).
     */
    readonly originalWidth: number;
    /** Pixel height of the input image; see {@link originalWidth}. */
    readonly originalHeight: number;
    readonly changed: boolean;
    readonly originalByteLength: number;
    readonly finalByteLength: number;
}
/**
 * Convenience wrapper for call sites that already hold base64 (MCP results,
 * data URLs). Decodes, compresses, and re-encodes to base64. Best effort:
 * returns the original base64 unchanged on any failure — including formats it
 * cannot re-encode, so callers must refuse MIME types outside the
 * provider-accepted set (`isModelAcceptedImageMime`) before building an
 * image part from the result.
 */
export declare function compressBase64ForModel(base64: string, mimeType: string, options?: CompressImageOptions): Promise<CompressBase64Result>;
export interface CompressedContentParts {
    /** The input parts with oversized inline images re-encoded in place. */
    readonly parts: ContentPart[];
    /**
     * One {@link buildImageCompressionCaption} note per re-encoded image, in
     * encounter order, when `annotate` is set. Returned as data — never
     * inserted into `parts` — so the caller picks the channel (the MCP path
     * joins them into the tool result's `note`) and quoted caption text in
     * the tool's own output can never be mistaken for a generated one.
     */
    readonly captions: readonly string[];
}
/**
 * Enforce the provider-accepted image format set (see ./image-format-policy)
 * on a content-part list. Inline `data:` image parts whose MIME is outside
 * the accepted set are dropped and replaced with a text notice, so one
 * unsupported image cannot poison the session history. Accepted images are
 * forwarded only as the byte-exact canonical data URL: an alias
 * (`image/jpg`), case/whitespace variants, or MIME parameters
 * (`image/jpeg;charset=utf-8`) all rebuild to the bare canonical form,
 * because strict provider whitelists exact-match the full header. Remote
 * (non-data) image URLs and non-image parts pass through — a URL carries no
 * bytes to inspect.
 *
 * The BYTES are authoritative, not the declared MIME: the header of each
 * inline image is sniffed, and a mismatch (e.g. AVIF bytes an MCP image
 * search tool labels `image/png`) is gated on what the image IS — the
 * provider decodes bytes, not labels. When the sniffer doesn't recognize
 * the bytes (corrupt image, exotic container), the declared MIME stands
 * and the 400-recovery path remains the backstop.
 *
 * This is the format gate shared by every ingestion point; run it BEFORE
 * compression so unsupported bytes are never decoded.
 */
export declare function gateImageFormatParts(parts: readonly ContentPart[]): ContentPart[];
/**
 * Compress any inline base64 image parts in a content-part list — used by
 * the MCP tool-result path (prompt ingestion compresses per image with
 * {@link compressBase64ForModel} while constructing the part). Image parts
 * whose URL is not a `data:` URL (e.g. a remote http(s) image) are passed
 * through, as are non-image parts. Best effort: a part that fails to
 * compress is left unchanged.
 *
 * The format gate ({@link gateImageFormatParts}) runs first: parts whose
 * MIME is outside the provider-accepted set are never forwarded — the part
 * is dropped and a text notice stands in, so one unsupported image cannot
 * poison the session history. This is the MCP funnel's enforcement point —
 * MCP servers can return any `image/*` MIME (e.g. AVIF from an image search
 * tool).
 *
 * With `annotate` set, every image that was actually re-encoded gets a
 * caption in {@link CompressedContentParts.captions} so the model knows it
 * is looking at a downsampled copy. `annotate.persistOriginal` additionally
 * saves the pre-compression bytes and puts the returned path in the caption
 * so the model can read the original back; persistence failures degrade to
 * a caption without a path.
 */
export declare function compressImageContentParts(parts: readonly ContentPart[], options?: CompressImageOptions & {
    readonly annotate?: CompressAnnotateOptions;
}): Promise<CompressedContentParts>;
export interface CompressAnnotateOptions {
    /**
     * Persist the pre-compression original bytes somewhere the model can read
     * them back; return the absolute path, or null when persistence failed.
     */
    readonly persistOriginal?: (bytes: Uint8Array, mimeType: string) => Promise<string | null>;
}
/**
 * Crop rectangle in ORIGINAL-image pixel coordinates — the decoded,
 * EXIF-rotated space that compression results report as the original size.
 */
export interface ImageCropRegion {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}
export interface CropImageOptions extends CompressImageOptions {
    /**
     * Keep the crop at native resolution (no edge-fit downscale). The byte
     * budget still applies: a crop that cannot be encoded within it fails
     * explicitly instead of being silently degraded.
     */
    readonly skipResize?: boolean;
}
export interface CropImageSuccess {
    readonly ok: true;
    readonly data: Uint8Array;
    readonly mimeType: string;
    /** Pixel size of the encoded crop actually produced. */
    readonly width: number;
    readonly height: number;
    /** Pixel size of the source image the region was cut from. */
    readonly originalWidth: number;
    readonly originalHeight: number;
    /** The region actually applied, after clamping to the image bounds. */
    readonly region: ImageCropRegion;
    /** True when the crop was downscaled to fit the pixel/byte budget. */
    readonly resized: boolean;
    readonly originalByteLength: number;
    readonly finalByteLength: number;
}
export interface CropImageFailure {
    readonly ok: false;
    /** Human/model-readable reason, safe to surface as a tool error. */
    readonly error: string;
}
export type CropImageOutcome = CropImageSuccess | CropImageFailure;
/**
 * Cut `region` out of `bytes` and encode it for the model.
 *
 * Unlike {@link compressImageForModel}, cropping is an explicit request: it
 * never falls back to the full image. Anything that prevents an accurate crop
 * (unsupported format, undecodable bytes, a region outside the image, a
 * skipResize result over the byte budget) returns `ok: false` with a reason
 * the caller can hand straight back to the model.
 *
 * The default path fits the crop to the usual pixel/byte budgets; a crop no
 * larger than the edge cap is therefore delivered at native resolution.
 */
export declare function cropImageForModel(bytes: Uint8Array, mimeType: string, region: ImageCropRegion, options?: CropImageOptions): Promise<CropImageOutcome>;
export interface ImageVariantDescription {
    /** Pixel size; pass 0 when unknown to omit the dimensions. */
    readonly width: number;
    readonly height: number;
    readonly byteLength: number;
    readonly mimeType: string;
}
export interface ImageCompressionCaptionInput {
    readonly original: ImageVariantDescription;
    readonly final: ImageVariantDescription;
    /** Absolute path where the pre-compression original can be read back. */
    readonly originalPath?: string | null;
}
/**
 * Render the shared `<system>` note placed next to a compressed image so the
 * model knows it is looking at a downsampled copy: what the original was, what
 * was actually sent, and — when the original is on disk — where to read it
 * back (via ReadMediaFile `region`) for full-fidelity detail.
 *
 * Two channels consume this note differently:
 *  - Tool results (MCP images): {@link compressImageContentParts} returns
 *    the captions as data and the MCP output pipeline joins them into the
 *    result's `note` side channel (rendered to the model at projection
 *    time, never to UIs).
 *  - User prompts must not render raw `<system>` markup in the UI, so the
 *    context layer detects the caption via
 *    {@link extractImageCompressionCaptions} and reroutes it through the
 *    built-in system-reminder injection (hidden by its `injection` origin).
 */
export declare function buildImageCompressionCaption(input: ImageCompressionCaptionInput): string;
export interface ImageCompressionCaptionExtraction {
    /** Caption bodies found, in order, without the `<system>` wrapper. */
    readonly captions: readonly string[];
    /** The input text with every caption removed. */
    readonly text: string;
}
/**
 * Find every {@link buildImageCompressionCaption} note embedded in `text` and
 * return the unwrapped caption bodies plus the text without them. Prompt
 * ingestion (server upload/base64 route, TUI paste, ACP) places the caption
 * inline next to the image — sometimes merged into an adjacent text segment —
 * and the context layer uses this to reroute the note through the built-in
 * system-reminder injection instead of leaving raw `<system>` markup in the
 * user-visible message.
 */
export declare function extractImageCompressionCaptions(text: string): ImageCompressionCaptionExtraction;
/** Human-readable byte size: `640 B`, `128 KB`, `3.8 MB`. */
export declare function formatByteSize(bytes: number): string;
