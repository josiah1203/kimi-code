/**
 * ReadMediaFileTool — read image/video files as multi-modal content.
 *
 * Returns a 3-part wrap as `output`:
 * `[TextPart('<image|video path="…">'), ImageContent|VideoContent,
 *   TextPart('</image|video>')]`
 * plus a `note` side channel (rendered to the model, never to UIs), and
 * gates on the model's `image_in` / `video_in` capability.
 *
 * The note — this tool wraps it in a `<system>` block as its own wording
 * choice — summarizes mime type, byte size and (for images) original pixel
 * dimensions, states exactly how the image was delivered (untouched,
 * downsampled, cropped, or native resolution) so compression is never
 * silent, guides the model to derive absolute coordinates from the original
 * size, and reminds it to re-read any media it generates or edits.
 *
 * Images support two opt-in delivery controls: `region` cuts a rectangle
 * (original-image pixel coordinates) out of the file so fine detail survives
 * at full fidelity, and `full_resolution` skips the default downscale when
 * the payload fits the per-image byte budget (refusing explicitly when it
 * does not, instead of silently degrading).
 *
 * Path safety: goes through the shared path access resolver used by
 * Read/Write/Edit.
 */
import type { Kaos } from '@spiderbyte/kaos';
import type { ModelCapability, VideoUploadInput as ProviderVideoUploadInput } from '@spiderbyte/kosong';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import type { TelemetryClient } from '../../../telemetry';
import { type VideoUploader } from '../../support/video-delivery';
import { ImageLimits } from '../../support/image-limits';
import type { WorkspaceConfig } from '../../support/workspace';
export declare const MAX_MEDIA_BYTES: number;
export type VideoUploadInput = ProviderVideoUploadInput;
export type { VideoUploader };
export declare const ReadMediaFileInputSchema: z.ZodObject<{
    path: z.ZodString;
    region: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strip>>;
    full_resolution: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type ReadMediaFileInput = z.Infer<typeof ReadMediaFileInputSchema>;
export declare class ReadMediaFileTool implements BuiltinTool<ReadMediaFileInput> {
    private readonly kaos;
    private readonly workspace;
    private readonly capabilities;
    private readonly videoUploader?;
    readonly name: "ReadMediaFile";
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    private readonly compressTelemetry;
    private readonly imageLimits;
    constructor(kaos: Kaos, workspace: WorkspaceConfig, capabilities: ModelCapability, videoUploader?: VideoUploader | undefined, telemetry?: TelemetryClient, imageLimits?: ImageLimits);
    /**
     * Deliver a video through the provider's upload channel when available,
     * falling back to an inline base64 part when the channel is missing or
     * broken (e.g. the provider has no files endpoint) — a failed upload must
     * not turn the whole read into an error. Auth rejections (401/403) are
     * the exception: they must surface, because they drive credential
     * refresh and a clear auth error instead of masking a bad token behind
     * an inline payload the next request will also reject.
     */
    private videoContentPart;
    resolveExecution(args: ReadMediaFileInput): ToolExecution;
    private execution;
}
