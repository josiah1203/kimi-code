import type { Logger } from '#/logging/types';
import type { ChatProvider, GenerateOptions, Message, Tool } from '@spiderbyte/kosong';
import type { LLMRequestLogFields } from '../loop';
export type GenerateOptionsWithRequestLogFields = GenerateOptions & {
    readonly requestLogFields?: LLMRequestLogFields;
};
export declare class LlmRequestLogger {
    private readonly log;
    private lastConfigLogSignature;
    constructor(log: Logger);
    logRequest(input: {
        readonly provider: ChatProvider;
        readonly modelAlias?: string;
        readonly systemPrompt: string;
        readonly tools: readonly Tool[];
        readonly messages: readonly Message[];
        readonly fields: LLMRequestLogFields | undefined;
    }): void;
}
export declare function splitGenerateOptions(options: GenerateOptionsWithRequestLogFields | undefined): {
    readonly requestLogFields: LLMRequestLogFields | undefined;
    readonly generateOptions: GenerateOptions | undefined;
};
export declare function toolSignature(tools: readonly Tool[]): {
    name: Tool;
    description: Tool;
    parameters: Tool;
}[];
export declare function fingerprint(content: string): string;
