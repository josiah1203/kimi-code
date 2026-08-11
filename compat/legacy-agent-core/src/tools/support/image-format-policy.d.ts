/**
 * Provider-accepted image formats — the single source of truth.
 *
 * Model providers accept only PNG, JPEG, GIF, and WebP image blocks. An
 * `image_url` part carrying any other MIME (AVIF, HEIC, BMP, TIFF, ICO, …)
 * is rejected by the API — and because prompts and tool results persist in
 * the session history, that one part makes every subsequent request fail
 * too ("session poisoning"). Every ingestion point therefore refuses
 * unsupported formats instead of passing the bytes through: ReadMediaFile
 * refuses with a conversion command the model can run, and prompt/MCP
 * ingestion replaces the image with a text notice.
 *
 * The policy is deliberately a closed set, not a denylist: a format is only
 * ever sent when it is known to be accepted. Supporting a new format means
 * adding it to {@link MODEL_ACCEPTED_IMAGE_MIMES}; tailoring the refusal
 * guidance for a newly-seen unsupported format means adding one row to
 * {@link UNSUPPORTED_IMAGE_FORMATS}.
 *
 * Inbound MIME strings are normalized for the DECISION
 * ({@link normalizeImageMime}: case, whitespace, `image/jpg`), but every
 * call site must forward the CANONICAL MIME into the session — strict
 * provider whitelists (e.g. Anthropic's) reject the raw alias, which would
 * re-create the very session poisoning this module exists to prevent.
 *
 * Scope: only inline `data:` images can be gated. A remote http(s) image URL
 * (an MCP `resource_link`, a REST `source.kind: 'url'` part) carries no
 * bytes to inspect, and providers that support URL images fetch them
 * server-side; those pass through unchanged.
 */
/** Image MIME types every provider accepts. The closed set. */
export declare const MODEL_ACCEPTED_IMAGE_MIMES: ReadonlySet<string>;
/**
 * Lowercase, drop MIME parameters, and apply the `image/jpg` alias. Parameter
 * stripping keeps a declared media type like `image/jpeg; charset=utf-8`
 * consistent with a data-URL MIME token (which the parser already clips at
 * the first `;`), so an accepted image with parameters is treated exactly
 * like the bare form instead of being misread as unsupported.
 */
export declare function normalizeImageMime(mimeType: string): string;
/**
 * Decode just the prefix of a base64 payload needed for magic-byte
 * sniffing, without allocating the full image. `Buffer.from` never throws
 * on malformed base64 — it decodes what it can.
 */
export declare function decodeBase64Prefix(base64: string): Buffer;
/**
 * The MIME an image should be judged by: the sniffed bytes when the magic
 * header is recognized (bytes are authoritative — a mislabeled image, e.g.
 * AVIF bytes an MCP image search tool labels `image/png`, is gated on what
 * it IS, because the provider decodes bytes not labels), else the declared
 * MIME. A header recognized as a non-image container also wins, so a video
 * file hiding in an image part is refused instead of trusted.
 */
export declare function resolveEffectiveImageMime(declaredMime: string, header: Uint8Array): string;
/**
 * Whether a non-data image URL points at a format providers reject, judged
 * by its path extension. A best-effort heuristic for the case where there
 * are no bytes to sniff (a remote http(s) image): catches the common
 * search-tool direct link ending in `.avif`. Query string and fragment are
 * ignored; the match is case-insensitive. URLs without an extension, or
 * whose extension lies, fall through to the provider — and to the 400
 * recovery — unchanged.
 *
 * Returns the unsupported MIME when the extension is known and not in the
 * accepted set (so the notice names the right format), else null.
 */
export declare function unsupportedImageMimeFromUrl(url: string): string | null;
/**
 * Parse an image `data:` URL into its MIME and base64 payload. The MIME is
 * returned raw — callers decide via {@link isModelAcceptedImageMime} and
 * forward {@link normalizeImageMime}. MIME parameters are tolerated and
 * ignored (`data:image/avif;charset=utf-8;base64,…`), so a parameter-bearing
 * URL cannot slip past the format gate. The scheme and `base64` marker are
 * matched case-insensitively (RFC 2045 encoding names are case-insensitive),
 * so an uppercase `;BASE64,` cannot slip past either — and since callers
 * rebuild to the canonical URL, the marker comes back out lowercase.
 * Returns null for non-data URLs (e.g. a remote http(s) image — see the
 * scope note in the module header).
 */
export declare function parseImageDataUrl(url: string): {
    mimeType: string;
    base64: string;
} | null;
/**
 * Whether a URL claims to be a `data:` URL (the scheme is case-insensitive).
 * Used to distinguish "failed to parse a data URL" (malformed — guaranteed
 * to fail at the provider) from "not a data URL" (a remote http(s) image
 * the provider fetches).
 */
export declare function isDataUrl(url: string): boolean;
/**
 * Whether an image with this MIME may be sent to the model. Only the closed
 * accepted set passes; everything else must be refused at the entry point —
 * once an unsupported `image_url` lands in the session history, every later
 * request in the session is rejected by the provider.
 */
export declare function isModelAcceptedImageMime(mimeType: string): boolean;
/**
 * Refusal for an unsupported image that has a readable file path, with a
 * conversion command matching the execution environment (`kaos.osEnv.osKind`
 * — where Bash actually runs, so SSH/container sessions get the right command
 * too). The model can run the command through Bash (under the normal
 * permission flow) and read the converted file.
 *
 * macOS converts with the built-in `sips`; Linux and Windows have no built-in
 * decoder for these formats, so the guidance names ImageMagick (plus the
 * format's dedicated Linux decoder when one exists, e.g. heif-convert).
 */
export declare function buildImageConversionGuidance(path: string, mimeType: string, osKind: string): string;
/**
 * Short notice standing in for an unsupported image where there is no file
 * path to point at (MCP tool results, prompt uploads): the image part is
 * dropped and this text replaces it, so the model knows what happened and
 * the session history stays free of formats the provider rejects.
 */
export declare function buildUnsupportedImageNotice(mimeType: string, name?: string): string;
/**
 * Notice standing in for an image part whose `data:` URL could not be parsed
 * at all (missing `;base64,` separator, empty MIME, …): the provider is
 * guaranteed to reject it, so it is dropped at ingestion instead of being
 * left to poison the session and trigger the media-stripped resend on every
 * later turn. The URL is truncated — a malformed payload can be huge.
 */
export declare function buildMalformedImageNotice(url: string): string;
