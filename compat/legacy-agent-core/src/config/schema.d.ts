import { z } from 'zod';
export declare const ProviderTypeSchema: z.ZodEnum<{
    kimi: "kimi";
    anthropic: "anthropic";
    openai: "openai";
    openai_responses: "openai_responses";
    vertexai: "vertexai";
    "google-genai": "google-genai";
}>;
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export declare const OAuthRefSchema: z.ZodObject<{
    storage: z.ZodEnum<{
        file: "file";
        keyring: "keyring";
    }>;
    key: z.ZodString;
    oauthHost: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type OAuthRef = z.infer<typeof OAuthRefSchema>;
export declare const ProviderConfigSchema: z.ZodObject<{
    type: z.ZodEnum<{
        kimi: "kimi";
        anthropic: "anthropic";
        openai: "openai";
        openai_responses: "openai_responses";
        vertexai: "vertexai";
        "google-genai": "google-genai";
    }>;
    apiKey: z.ZodOptional<z.ZodString>;
    baseUrl: z.ZodOptional<z.ZodString>;
    defaultModel: z.ZodOptional<z.ZodString>;
    oauth: z.ZodOptional<z.ZodObject<{
        storage: z.ZodEnum<{
            file: "file";
            keyring: "keyring";
        }>;
        key: z.ZodString;
        oauthHost: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    source: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export declare const ModelAliasOverrideSchema: z.ZodObject<{
    maxContextSize: z.ZodOptional<z.ZodNumber>;
    capabilities: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    displayName: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    adaptiveThinking: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    supportEfforts: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    defaultEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    maxOutputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    reasoningKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    offEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    maxInputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export type ModelAliasOverrides = z.infer<typeof ModelAliasOverrideSchema>;
export declare const ModelAliasSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    maxContextSize: z.ZodNumber;
    maxInputSize: z.ZodOptional<z.ZodNumber>;
    maxOutputSize: z.ZodOptional<z.ZodNumber>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
    displayName: z.ZodOptional<z.ZodString>;
    reasoningKey: z.ZodOptional<z.ZodString>;
    protocol: z.ZodOptional<z.ZodLiteral<"anthropic">>;
    adaptiveThinking: z.ZodOptional<z.ZodBoolean>;
    supportEfforts: z.ZodOptional<z.ZodArray<z.ZodString>>;
    defaultEffort: z.ZodOptional<z.ZodString>;
    offEffort: z.ZodOptional<z.ZodString>;
    betaApi: z.ZodOptional<z.ZodBoolean>;
    baseUrl: z.ZodOptional<z.ZodString>;
    overrides: z.ZodOptional<z.ZodObject<{
        maxContextSize: z.ZodOptional<z.ZodNumber>;
        capabilities: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        displayName: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        adaptiveThinking: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        supportEfforts: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        defaultEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        maxOutputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        reasoningKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        offEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        maxInputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ModelAlias = z.infer<typeof ModelAliasSchema>;
/**
 * The secondary-model recipe (`[secondary_model]` on disk): `model` points at
 * a `[models]` entry and every remaining field is a subagent-only patch,
 * materialized into a synthesized derived model entry at runtime (see
 * `config/secondary-model.ts`). `default_effort` doubles as the subagent
 * thinking effort.
 */
export declare const SecondaryModelConfigSchema: z.ZodObject<{
    maxContextSize: z.ZodOptional<z.ZodNumber>;
    capabilities: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    displayName: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    adaptiveThinking: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    supportEfforts: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    defaultEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    maxOutputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    reasoningKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    offEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    maxInputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    model: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SecondaryModelConfig = z.infer<typeof SecondaryModelConfigSchema>;
export declare const ThinkingConfigSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    effort: z.ZodOptional<z.ZodString>;
    keep: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>;
export declare const PermissionModeSchema: z.ZodEnum<{
    auto: "auto";
    manual: "manual";
    yolo: "yolo";
}>;
export declare const PermissionRuleDecisionSchema: z.ZodEnum<{
    allow: "allow";
    deny: "deny";
    ask: "ask";
}>;
export declare const PermissionRuleScopeSchema: z.ZodEnum<{
    user: "user";
    project: "project";
    "turn-override": "turn-override";
    "session-runtime": "session-runtime";
}>;
export declare const PermissionRuleSchema: z.ZodObject<{
    decision: z.ZodEnum<{
        allow: "allow";
        deny: "deny";
        ask: "ask";
    }>;
    scope: z.ZodDefault<z.ZodEnum<{
        user: "user";
        project: "project";
        "turn-override": "turn-override";
        "session-runtime": "session-runtime";
    }>>;
    pattern: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const PermissionConfigSchema: z.ZodObject<{
    rules: z.ZodOptional<z.ZodArray<z.ZodObject<{
        decision: z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>;
        scope: z.ZodDefault<z.ZodEnum<{
            user: "user";
            project: "project";
            "turn-override": "turn-override";
            "session-runtime": "session-runtime";
        }>>;
        pattern: z.ZodString;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type PermissionConfig = z.infer<typeof PermissionConfigSchema>;
export declare const LoopControlSchema: z.ZodObject<{
    maxStepsPerTurn: z.ZodOptional<z.ZodNumber>;
    maxRetriesPerStep: z.ZodOptional<z.ZodNumber>;
    maxRalphIterations: z.ZodOptional<z.ZodNumber>;
    reservedContextSize: z.ZodOptional<z.ZodNumber>;
    compactionTriggerRatio: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type LoopControl = z.infer<typeof LoopControlSchema>;
export declare const BackgroundConfigSchema: z.ZodObject<{
    maxRunningTasks: z.ZodOptional<z.ZodNumber>;
    keepAliveOnExit: z.ZodOptional<z.ZodBoolean>;
    bashAutoBackgroundOnTimeout: z.ZodOptional<z.ZodBoolean>;
    bashTaskTimeoutS: z.ZodOptional<z.ZodNumber>;
    killGracePeriodMs: z.ZodOptional<z.ZodNumber>;
    printWaitCeilingS: z.ZodOptional<z.ZodNumber>;
    printBackgroundMode: z.ZodOptional<z.ZodEnum<{
        exit: "exit";
        steer: "steer";
        drain: "drain";
    }>>;
    printMaxTurns: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type BackgroundConfig = z.infer<typeof BackgroundConfigSchema>;
export declare const SubagentConfigSchema: z.ZodObject<{
    timeoutMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type SubagentConfig = z.infer<typeof SubagentConfigSchema>;
export declare const MAX_MCP_TIMEOUT_MS = 2147483647;
export declare const McpConfigSchema: z.ZodObject<{
    startupTimeoutMs: z.ZodOptional<z.ZodNumber>;
    toolTimeoutMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export declare const ImageConfigSchema: z.ZodObject<{
    maxEdgePx: z.ZodOptional<z.ZodNumber>;
    readByteBudget: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ImageConfig = z.infer<typeof ImageConfigSchema>;
export declare const ModelCatalogConfigSchema: z.ZodObject<{
    refreshIntervalMs: z.ZodOptional<z.ZodNumber>;
    refreshOnStart: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type ModelCatalogConfig = z.infer<typeof ModelCatalogConfigSchema>;
export declare const ExperimentalConfigSchema: z.ZodRecord<z.ZodString, z.ZodBoolean>;
export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>;
export declare const HookDefSchema: z.ZodObject<{
    event: z.ZodEnum<{
        PreToolUse: "PreToolUse";
        PostToolUse: "PostToolUse";
        PostToolUseFailure: "PostToolUseFailure";
        PermissionRequest: "PermissionRequest";
        PermissionResult: "PermissionResult";
        UserPromptSubmit: "UserPromptSubmit";
        Stop: "Stop";
        StopFailure: "StopFailure";
        Interrupt: "Interrupt";
        SessionStart: "SessionStart";
        SessionEnd: "SessionEnd";
        SubagentStart: "SubagentStart";
        SubagentStop: "SubagentStop";
        PreCompact: "PreCompact";
        PostCompact: "PostCompact";
        Notification: "Notification";
    }>;
    matcher: z.ZodOptional<z.ZodString>;
    command: z.ZodString;
    timeout: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type HookDefConfig = z.infer<typeof HookDefSchema>;
export declare const MoonshotServiceConfigSchema: z.ZodObject<{
    baseUrl: z.ZodOptional<z.ZodString>;
    apiKey: z.ZodOptional<z.ZodString>;
    oauth: z.ZodOptional<z.ZodObject<{
        storage: z.ZodEnum<{
            file: "file";
            keyring: "keyring";
        }>;
        key: z.ZodString;
        oauthHost: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export type MoonshotServiceConfig = z.infer<typeof MoonshotServiceConfigSchema>;
export declare const ServicesConfigSchema: z.ZodObject<{
    moonshotSearch: z.ZodOptional<z.ZodObject<{
        baseUrl: z.ZodOptional<z.ZodString>;
        apiKey: z.ZodOptional<z.ZodString>;
        oauth: z.ZodOptional<z.ZodObject<{
            storage: z.ZodEnum<{
                file: "file";
                keyring: "keyring";
            }>;
            key: z.ZodString;
            oauthHost: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>;
    moonshotFetch: z.ZodOptional<z.ZodObject<{
        baseUrl: z.ZodOptional<z.ZodString>;
        apiKey: z.ZodOptional<z.ZodString>;
        oauth: z.ZodOptional<z.ZodObject<{
            storage: z.ZodEnum<{
                file: "file";
                keyring: "keyring";
            }>;
            key: z.ZodString;
            oauthHost: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ServicesConfig = z.infer<typeof ServicesConfigSchema>;
export declare const McpServerStdioConfigSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    startupTimeoutMs: z.ZodOptional<z.ZodNumber>;
    toolTimeoutMs: z.ZodOptional<z.ZodNumber>;
    enabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    transport: z.ZodLiteral<"stdio">;
    command: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    cwd: z.ZodOptional<z.ZodString>;
    executor: z.ZodOptional<z.ZodEnum<{
        local: "local";
        kaos: "kaos";
    }>>;
}, z.core.$strip>;
export type McpServerStdioConfig = z.infer<typeof McpServerStdioConfigSchema>;
export declare const McpServerHttpConfigSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    startupTimeoutMs: z.ZodOptional<z.ZodNumber>;
    toolTimeoutMs: z.ZodOptional<z.ZodNumber>;
    enabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    transport: z.ZodLiteral<"http">;
    url: z.ZodString;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    auth: z.ZodOptional<z.ZodLiteral<"oauth">>;
    bearerTokenEnvVar: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type McpServerHttpConfig = z.infer<typeof McpServerHttpConfigSchema>;
export declare const McpServerSseConfigSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    startupTimeoutMs: z.ZodOptional<z.ZodNumber>;
    toolTimeoutMs: z.ZodOptional<z.ZodNumber>;
    enabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    transport: z.ZodLiteral<"sse">;
    url: z.ZodString;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    auth: z.ZodOptional<z.ZodLiteral<"oauth">>;
    bearerTokenEnvVar: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type McpServerSseConfig = z.infer<typeof McpServerSseConfigSchema>;
export type McpRemoteServerConfig = McpServerHttpConfig | McpServerSseConfig;
export declare const McpServerConfigSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodDiscriminatedUnion<[z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    startupTimeoutMs: z.ZodOptional<z.ZodNumber>;
    toolTimeoutMs: z.ZodOptional<z.ZodNumber>;
    enabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    transport: z.ZodLiteral<"stdio">;
    command: z.ZodString;
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    cwd: z.ZodOptional<z.ZodString>;
    executor: z.ZodOptional<z.ZodEnum<{
        local: "local";
        kaos: "kaos";
    }>>;
}, z.core.$strip>, z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    startupTimeoutMs: z.ZodOptional<z.ZodNumber>;
    toolTimeoutMs: z.ZodOptional<z.ZodNumber>;
    enabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    transport: z.ZodLiteral<"http">;
    url: z.ZodString;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    auth: z.ZodOptional<z.ZodLiteral<"oauth">>;
    bearerTokenEnvVar: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    startupTimeoutMs: z.ZodOptional<z.ZodNumber>;
    toolTimeoutMs: z.ZodOptional<z.ZodNumber>;
    enabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    disabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    transport: z.ZodLiteral<"sse">;
    url: z.ZodString;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    auth: z.ZodOptional<z.ZodLiteral<"oauth">>;
    bearerTokenEnvVar: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "transport">>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export declare const KimiConfigSchema: z.ZodObject<{
    providers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        type: z.ZodEnum<{
            kimi: "kimi";
            anthropic: "anthropic";
            openai: "openai";
            openai_responses: "openai_responses";
            vertexai: "vertexai";
            "google-genai": "google-genai";
        }>;
        apiKey: z.ZodOptional<z.ZodString>;
        baseUrl: z.ZodOptional<z.ZodString>;
        defaultModel: z.ZodOptional<z.ZodString>;
        oauth: z.ZodOptional<z.ZodObject<{
            storage: z.ZodEnum<{
                file: "file";
                keyring: "keyring";
            }>;
            key: z.ZodString;
            oauthHost: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        source: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>>;
    defaultProvider: z.ZodOptional<z.ZodString>;
    defaultModel: z.ZodOptional<z.ZodString>;
    models: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        maxContextSize: z.ZodNumber;
        maxInputSize: z.ZodOptional<z.ZodNumber>;
        maxOutputSize: z.ZodOptional<z.ZodNumber>;
        capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
        displayName: z.ZodOptional<z.ZodString>;
        reasoningKey: z.ZodOptional<z.ZodString>;
        protocol: z.ZodOptional<z.ZodLiteral<"anthropic">>;
        adaptiveThinking: z.ZodOptional<z.ZodBoolean>;
        supportEfforts: z.ZodOptional<z.ZodArray<z.ZodString>>;
        defaultEffort: z.ZodOptional<z.ZodString>;
        offEffort: z.ZodOptional<z.ZodString>;
        betaApi: z.ZodOptional<z.ZodBoolean>;
        baseUrl: z.ZodOptional<z.ZodString>;
        overrides: z.ZodOptional<z.ZodObject<{
            maxContextSize: z.ZodOptional<z.ZodNumber>;
            capabilities: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
            displayName: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            adaptiveThinking: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            supportEfforts: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
            defaultEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            maxOutputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            reasoningKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            offEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            maxInputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    thinking: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        effort: z.ZodOptional<z.ZodString>;
        keep: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    planMode: z.ZodOptional<z.ZodBoolean>;
    yolo: z.ZodOptional<z.ZodBoolean>;
    defaultPermissionMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        manual: "manual";
        yolo: "yolo";
    }>>;
    defaultPlanMode: z.ZodOptional<z.ZodBoolean>;
    permission: z.ZodOptional<z.ZodObject<{
        rules: z.ZodOptional<z.ZodArray<z.ZodObject<{
            decision: z.ZodEnum<{
                allow: "allow";
                deny: "deny";
                ask: "ask";
            }>;
            scope: z.ZodDefault<z.ZodEnum<{
                user: "user";
                project: "project";
                "turn-override": "turn-override";
                "session-runtime": "session-runtime";
            }>>;
            pattern: z.ZodString;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    hooks: z.ZodOptional<z.ZodArray<z.ZodObject<{
        event: z.ZodEnum<{
            PreToolUse: "PreToolUse";
            PostToolUse: "PostToolUse";
            PostToolUseFailure: "PostToolUseFailure";
            PermissionRequest: "PermissionRequest";
            PermissionResult: "PermissionResult";
            UserPromptSubmit: "UserPromptSubmit";
            Stop: "Stop";
            StopFailure: "StopFailure";
            Interrupt: "Interrupt";
            SessionStart: "SessionStart";
            SessionEnd: "SessionEnd";
            SubagentStart: "SubagentStart";
            SubagentStop: "SubagentStop";
            PreCompact: "PreCompact";
            PostCompact: "PostCompact";
            Notification: "Notification";
        }>;
        matcher: z.ZodOptional<z.ZodString>;
        command: z.ZodString;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>;
    services: z.ZodOptional<z.ZodObject<{
        moonshotSearch: z.ZodOptional<z.ZodObject<{
            baseUrl: z.ZodOptional<z.ZodString>;
            apiKey: z.ZodOptional<z.ZodString>;
            oauth: z.ZodOptional<z.ZodObject<{
                storage: z.ZodEnum<{
                    file: "file";
                    keyring: "keyring";
                }>;
                key: z.ZodString;
                oauthHost: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strip>>;
        moonshotFetch: z.ZodOptional<z.ZodObject<{
            baseUrl: z.ZodOptional<z.ZodString>;
            apiKey: z.ZodOptional<z.ZodString>;
            oauth: z.ZodOptional<z.ZodObject<{
                storage: z.ZodEnum<{
                    file: "file";
                    keyring: "keyring";
                }>;
                key: z.ZodString;
                oauthHost: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    mergeAllAvailableSkills: z.ZodOptional<z.ZodBoolean>;
    extraSkillDirs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    extraAgentDirs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    loopControl: z.ZodOptional<z.ZodObject<{
        maxStepsPerTurn: z.ZodOptional<z.ZodNumber>;
        maxRetriesPerStep: z.ZodOptional<z.ZodNumber>;
        maxRalphIterations: z.ZodOptional<z.ZodNumber>;
        reservedContextSize: z.ZodOptional<z.ZodNumber>;
        compactionTriggerRatio: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    background: z.ZodOptional<z.ZodObject<{
        maxRunningTasks: z.ZodOptional<z.ZodNumber>;
        keepAliveOnExit: z.ZodOptional<z.ZodBoolean>;
        bashAutoBackgroundOnTimeout: z.ZodOptional<z.ZodBoolean>;
        bashTaskTimeoutS: z.ZodOptional<z.ZodNumber>;
        killGracePeriodMs: z.ZodOptional<z.ZodNumber>;
        printWaitCeilingS: z.ZodOptional<z.ZodNumber>;
        printBackgroundMode: z.ZodOptional<z.ZodEnum<{
            exit: "exit";
            steer: "steer";
            drain: "drain";
        }>>;
        printMaxTurns: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    subagent: z.ZodOptional<z.ZodObject<{
        timeoutMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    secondaryModel: z.ZodOptional<z.ZodObject<{
        maxContextSize: z.ZodOptional<z.ZodNumber>;
        capabilities: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        displayName: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        adaptiveThinking: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        supportEfforts: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        defaultEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        maxOutputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        reasoningKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        offEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        maxInputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        model: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    mcp: z.ZodOptional<z.ZodObject<{
        startupTimeoutMs: z.ZodOptional<z.ZodNumber>;
        toolTimeoutMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    image: z.ZodOptional<z.ZodObject<{
        maxEdgePx: z.ZodOptional<z.ZodNumber>;
        readByteBudget: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    modelCatalog: z.ZodOptional<z.ZodObject<{
        refreshIntervalMs: z.ZodOptional<z.ZodNumber>;
        refreshOnStart: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    experimental: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    telemetry: z.ZodOptional<z.ZodBoolean>;
    raw: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type KimiConfig = z.infer<typeof KimiConfigSchema>;
export declare const KimiConfigPatchSchema: z.ZodObject<{
    providers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        type: z.ZodOptional<z.ZodEnum<{
            kimi: "kimi";
            anthropic: "anthropic";
            openai: "openai";
            openai_responses: "openai_responses";
            vertexai: "vertexai";
            "google-genai": "google-genai";
        }>>;
        apiKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        baseUrl: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        defaultModel: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        oauth: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            storage: z.ZodEnum<{
                file: "file";
                keyring: "keyring";
            }>;
            key: z.ZodString;
            oauthHost: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        env: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
        customHeaders: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
        source: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    }, z.core.$strip>>>;
    defaultProvider: z.ZodOptional<z.ZodString>;
    defaultModel: z.ZodOptional<z.ZodString>;
    models: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        maxContextSize: z.ZodOptional<z.ZodNumber>;
        maxInputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        maxOutputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        capabilities: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        displayName: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        reasoningKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        protocol: z.ZodOptional<z.ZodOptional<z.ZodLiteral<"anthropic">>>;
        adaptiveThinking: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        supportEfforts: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
        defaultEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        offEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        betaApi: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        baseUrl: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        overrides: z.ZodOptional<z.ZodOptional<z.ZodObject<{
            maxContextSize: z.ZodOptional<z.ZodNumber>;
            capabilities: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
            displayName: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            adaptiveThinking: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
            supportEfforts: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>;
            defaultEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            maxOutputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
            reasoningKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            offEffort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            maxInputSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>;
    thinking: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        effort: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        keep: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    }, z.core.$strip>>;
    planMode: z.ZodOptional<z.ZodBoolean>;
    yolo: z.ZodOptional<z.ZodBoolean>;
    defaultPermissionMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        manual: "manual";
        yolo: "yolo";
    }>>;
    defaultPlanMode: z.ZodOptional<z.ZodBoolean>;
    permission: z.ZodOptional<z.ZodObject<{
        rules: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
            decision: z.ZodEnum<{
                allow: "allow";
                deny: "deny";
                ask: "ask";
            }>;
            scope: z.ZodDefault<z.ZodEnum<{
                user: "user";
                project: "project";
                "turn-override": "turn-override";
                "session-runtime": "session-runtime";
            }>>;
            pattern: z.ZodString;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>>;
    }, z.core.$strip>>;
    hooks: z.ZodOptional<z.ZodArray<z.ZodObject<{
        event: z.ZodEnum<{
            PreToolUse: "PreToolUse";
            PostToolUse: "PostToolUse";
            PostToolUseFailure: "PostToolUseFailure";
            PermissionRequest: "PermissionRequest";
            PermissionResult: "PermissionResult";
            UserPromptSubmit: "UserPromptSubmit";
            Stop: "Stop";
            StopFailure: "StopFailure";
            Interrupt: "Interrupt";
            SessionStart: "SessionStart";
            SessionEnd: "SessionEnd";
            SubagentStart: "SubagentStart";
            SubagentStop: "SubagentStop";
            PreCompact: "PreCompact";
            PostCompact: "PostCompact";
            Notification: "Notification";
        }>;
        matcher: z.ZodOptional<z.ZodString>;
        command: z.ZodString;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>;
    services: z.ZodOptional<z.ZodObject<{
        moonshotSearch: z.ZodOptional<z.ZodObject<{
            baseUrl: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            apiKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            oauth: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                storage: z.ZodEnum<{
                    file: "file";
                    keyring: "keyring";
                }>;
                key: z.ZodString;
                oauthHost: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>>;
            customHeaders: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
        }, z.core.$strip>>;
        moonshotFetch: z.ZodOptional<z.ZodObject<{
            baseUrl: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            apiKey: z.ZodOptional<z.ZodOptional<z.ZodString>>;
            oauth: z.ZodOptional<z.ZodOptional<z.ZodObject<{
                storage: z.ZodEnum<{
                    file: "file";
                    keyring: "keyring";
                }>;
                key: z.ZodString;
                oauthHost: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>>;
            customHeaders: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    mergeAllAvailableSkills: z.ZodOptional<z.ZodBoolean>;
    extraSkillDirs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    extraAgentDirs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    loopControl: z.ZodOptional<z.ZodObject<{
        maxStepsPerTurn: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        maxRetriesPerStep: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        maxRalphIterations: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        reservedContextSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        compactionTriggerRatio: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>;
    background: z.ZodOptional<z.ZodObject<{
        maxRunningTasks: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        keepAliveOnExit: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        bashAutoBackgroundOnTimeout: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
        bashTaskTimeoutS: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        killGracePeriodMs: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        printWaitCeilingS: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        printBackgroundMode: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
            exit: "exit";
            steer: "steer";
            drain: "drain";
        }>>>;
        printMaxTurns: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>;
    subagent: z.ZodOptional<z.ZodObject<{
        timeoutMs: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>;
    secondaryModel: z.ZodOptional<z.ZodObject<{
        maxContextSize: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        capabilities: z.ZodOptional<z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>>;
        displayName: z.ZodOptional<z.ZodOptional<z.ZodOptional<z.ZodString>>>;
        adaptiveThinking: z.ZodOptional<z.ZodOptional<z.ZodOptional<z.ZodBoolean>>>;
        supportEfforts: z.ZodOptional<z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString>>>>;
        defaultEffort: z.ZodOptional<z.ZodOptional<z.ZodOptional<z.ZodString>>>;
        maxOutputSize: z.ZodOptional<z.ZodOptional<z.ZodOptional<z.ZodNumber>>>;
        reasoningKey: z.ZodOptional<z.ZodOptional<z.ZodOptional<z.ZodString>>>;
        offEffort: z.ZodOptional<z.ZodOptional<z.ZodOptional<z.ZodString>>>;
        maxInputSize: z.ZodOptional<z.ZodOptional<z.ZodOptional<z.ZodNumber>>>;
        model: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    }, z.core.$strip>>;
    mcp: z.ZodOptional<z.ZodObject<{
        startupTimeoutMs: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        toolTimeoutMs: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>;
    image: z.ZodOptional<z.ZodObject<{
        maxEdgePx: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        readByteBudget: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>;
    modelCatalog: z.ZodOptional<z.ZodObject<{
        refreshIntervalMs: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
        refreshOnStart: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$strip>>;
    experimental: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    telemetry: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export type KimiConfigPatch = z.infer<typeof KimiConfigPatchSchema>;
export declare function getDefaultConfig(): KimiConfig;
export declare function validateConfig(config: unknown): KimiConfig;
export declare function formatConfigValidationError(error: unknown): string;
