/**
 * WebP decoding for the image-compression pipeline.
 *
 * The default jimp build ships no WebP codec, so WebP is decoded with
 * `@jsquash/webp`'s wasm decoder instead. The decoder wasm is compiled from a
 * base64 string committed to the repo (see `webp-dec-wasm.ts`): the published
 * CLI bundles every dependency into a single file with no runtime
 * node_modules, so a file-path or fetch lookup for the .wasm (what the
 * emscripten glue would do on its own) cannot work there — the module is
 * compiled and injected manually via the codec's `init()` hook. Only the
 * decoder is bundled: re-encoding runs through the existing PNG/JPEG ladder,
 * so the (larger) WebP encoder wasm is never needed.
 *
 * The repo's tsconfig carries no DOM lib, so the global `WebAssembly` and
 * `ImageData` names are unavailable at the type level — the wasm namespace is
 * reached through a structurally-typed `globalThis` and the decoder's RGBA
 * output is described by the local {@link DecodedWebp} shape.
 */
/** Decoded RGBA bitmap in the shape `Jimp.fromBitmap` accepts. */
export interface DecodedWebp {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
}
/**
 * Decode a (non-animated) WebP payload to RGBA. Throws on undecodable input —
 * callers keep their existing best-effort catch semantics.
 */
export declare function decodeWebp(bytes: Uint8Array): Promise<DecodedWebp>;
/**
 * True when the payload is a WebP whose VP8X container header carries the
 * ANIM flag. Animated WebP must be passed through, not re-encoded: decoding
 * yields a single frame and would silently destroy the animation (the same
 * reason GIF is passed through).
 */
export declare function isAnimatedWebp(bytes: Uint8Array): boolean;
