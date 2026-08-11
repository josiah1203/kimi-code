/**
 * Shared helper for deriving the JSON Schema that a tool advertises to the
 * model for its parameters.
 *
 * A tool's parameter schema describes the *input* the model is expected to
 * supply. zod v4's `toJSONSchema` defaults to the *output* view, which marks
 * any field carrying a chain-tail `.default()` as `required` — producing a
 * schema that simultaneously declares a `default` and lists the field as
 * required. That contradiction also makes the runtime AJV validator reject
 * legal calls that omit the defaulted fields.
 *
 * Always render parameter schemas through this helper so the `io: 'input'`
 * view is applied uniformly and defaulted fields remain optional, while the
 * closed-object guard (`additionalProperties: false`) is kept so unknown
 * arguments are still rejected.
 */
import { z } from 'zod';
/**
 * Convert a zod schema into the input JSON Schema exposed to the model.
 *
 * @param schema - The zod schema describing the tool's parameters.
 * @returns A draft-07 JSON Schema rendered with the input view.
 */
export declare function toInputJsonSchema(schema: z.ZodType): Record<string, unknown>;
