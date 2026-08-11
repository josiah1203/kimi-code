/**
 * Experimental feature flags.
 *
 * To add one, append an entry and gate runtime behavior through the scoped
 * resolver available on `KimiCore`, `Session`, or `Agent`:
 *   { id: 'my_feature', title: 'My feature', description: '...', env: 'KIMI_CODE_EXPERIMENTAL_MY_FEATURE', default: false, surface: 'both' }
 *
 * Keep the `as const satisfies` — it derives the literal `FlagId` union that gives `enabled()`
 * autocomplete and typo-checking. `env` must start with 'KIMI_CODE_EXPERIMENTAL_', be unique, and
 * not equal the master switch 'KIMI_CODE_EXPERIMENTAL_FLAG'; `id` must not be 'flag'.
 */
export declare const FLAG_DEFINITIONS: readonly [{
    readonly id: "tool-select";
    readonly title: "Tool select (progressive tool disclosure)";
    readonly description: "Keep MCP tool schemas out of the immutable top-level tools[]; the model loads them on demand via the select_tools tool. Only takes effect on models whose capability catalog declares dynamically loaded tools.";
    readonly env: "KIMI_CODE_EXPERIMENTAL_TOOL_SELECT";
    readonly default: false;
    readonly surface: "core";
}, {
    readonly id: "secondary-model";
    readonly title: "Secondary model for subagents";
    readonly description: "Let newly spawned subagents use a separately configured secondary model by default, with an explicit primary-model override for quality-sensitive tasks.";
    readonly env: "KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL";
    readonly default: false;
    readonly surface: "core";
}];
/** Literal union of registered flag ids. */
export type FlagId = (typeof FLAG_DEFINITIONS)[number]['id'];
