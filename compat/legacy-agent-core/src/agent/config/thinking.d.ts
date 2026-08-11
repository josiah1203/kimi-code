import type { ThinkingEffort } from '@spiderbyte/kosong';
import type { ModelAlias, ThinkingConfig } from '../../config/schema';
export type { ThinkingEffort };
/**
 * Resolve the default thinking effort for a model from its declared metadata:
 *   - models that do not support thinking (or an unknown model) -> `'off'`
 *   - effort-capable models -> `default_effort`, else the middle entry of
 *     `support_efforts` (so we never pick an effort the model does not support)
 *   - boolean models (thinking support without `support_efforts`) -> `'on'`
 *
 * `support_efforts` is the single source of truth for efforts; the returned
 * effort is always one the model can actually accept.
 */
export declare function defaultThinkingEffortFor(model: ModelAlias | undefined): ThinkingEffort;
export declare function supportsThinkingEffort(effort: ThinkingEffort, model: ModelAlias | undefined, kimiProtocol: boolean): boolean;
/**
 * Resolve the effective thinking effort for a session.
 *
 * Precedence:
 *   1. an explicit `requested` effort (per-session override) wins;
 *   2. `thinking.enabled === false` forces `'off'`;
 *   3. otherwise `thinking.effort` when set, else the model's default effort.
 *
 * A model that declares `always_thinking` can never resolve to `'off'`, on
 * any wire — a claimed off state would be a lie, since upstream keeps
 * reasoning at its default when no off encoding exists. (Compatible
 * protocols still receive every other requested value unchanged so their
 * backend can make the final capability decision.)
 */
export declare function resolveThinkingEffort(requested: ThinkingEffort | undefined, config: ThinkingConfig | undefined, model: ModelAlias | undefined, kimiProtocol?: boolean): ThinkingEffort;
