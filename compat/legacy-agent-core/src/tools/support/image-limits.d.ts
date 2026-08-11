/**
 * Owner-scoped resolution of the `[image]` config limits.
 *
 * One instance per owner (KimiCore in production; a fresh default for a
 * standalone Agent), mirroring the FlagResolver lifecycle: the owner pushes
 * its config on load and reload via {@link ImageLimits.setConfig}, and every
 * consumer resolves through the instance it was handed. Nothing is stored in
 * module state, so two cores in one process (the SDK's multi-client pattern)
 * each compress with their own `[image]` settings and a reload of one never
 * restamps the other.
 *
 * Resolution precedence per value: env var > owning config > built-in
 * default. Env stays process-level on purpose — it is the operator's
 * override for everything in the process, exactly like the experimental-flag
 * env switches.
 */
import type { ImageConfig } from '#/config/schema';
export declare class ImageLimits {
    private readonly env;
    private config;
    constructor(env?: Readonly<Record<string, string | undefined>>, config?: ImageConfig | undefined);
    /** Push (or clear, with `undefined`) the owning config. Called by the
     * config owner on load and reload, so limits hot-reload per owner. */
    setConfig(config: ImageConfig | undefined): void;
    /** Longest-edge ceiling (px) for compressing images for the model. */
    maxEdgePx(): number;
    /** Raw-byte budget for model-initiated image reads (ReadMediaFile default path). */
    readByteBudget(): number;
}
