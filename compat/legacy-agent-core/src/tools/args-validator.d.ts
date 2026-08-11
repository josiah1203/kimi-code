import { type ValidateFunction } from 'ajv';
export type JsonType = null | number | string | boolean | JsonArray | JsonObject;
/** @internal */
export interface JsonArray extends Array<JsonType> {
}
/** @internal */
export interface JsonObject extends Record<string, JsonType> {
}
export type ToolArgsValidator = ValidateFunction<JsonType>;
export declare function compileToolArgsValidator(schema: Record<string, unknown>): ToolArgsValidator;
export declare function validateToolArgs(validator: ToolArgsValidator, args: JsonType): string | null;
