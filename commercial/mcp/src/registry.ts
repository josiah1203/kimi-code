import type {
  CommercialAction,
  Principal,
} from '@spiderbyte/commercial-domain';
import type { CommercialEntitlementService } from '@spiderbyte/commercial-billing';

export interface CommercialMcpContext {
  readonly principal: Principal;
  readonly organization_id: string;
  readonly workspace_id?: string;
  readonly request_id: string;
}

export interface CommercialMcpAuthorization {
  authorize(context: CommercialMcpContext, action: CommercialAction): Promise<void>;
}

export interface CommercialMcpTool<Input, Output> {
  readonly name: string;
  readonly description: string;
  readonly action: CommercialAction;
  readonly entitlement?: string;
  invoke(context: CommercialMcpContext, input: Input): Promise<Output>;
}

export class CommercialMcpToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CommercialMcpToolError';
    this.code = code;
  }
}

export class CommercialMcpToolRegistry {
  private readonly tools = new Map<string, CommercialMcpTool<unknown, unknown>>();

  constructor(
    private readonly authorization: CommercialMcpAuthorization,
    private readonly entitlements: CommercialEntitlementService,
  ) {}

  register<Input, Output>(tool: CommercialMcpTool<Input, Output>): void {
    if (this.tools.has(tool.name)) throw new Error(`commercial MCP tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as CommercialMcpTool<unknown, unknown>);
  }

  async listAvailable(context: CommercialMcpContext): Promise<readonly CommercialMcpTool<unknown, unknown>[]> {
    const available: CommercialMcpTool<unknown, unknown>[] = [];
    for (const tool of this.tools.values()) {
      try {
        await this.authorization.authorize(context, tool.action);
        if (tool.entitlement !== undefined) await this.entitlements.assertIncluded(context.organization_id, tool.entitlement);
        available.push(tool);
      } catch {
        // Capability discovery is intentionally deny-by-default.
      }
    }
    return available;
  }

  async call<Input, Output>(name: string, context: CommercialMcpContext, input: Input): Promise<Output> {
    const tool = this.tools.get(name);
    if (tool === undefined) throw new CommercialMcpToolError('commercial.mcp.tool_not_found', 'commercial MCP tool is not registered');
    await this.authorization.authorize(context, tool.action);
    if (tool.entitlement !== undefined) await this.entitlements.assertIncluded(context.organization_id, tool.entitlement);
    return tool.invoke(context, input) as Promise<Output>;
  }
}
