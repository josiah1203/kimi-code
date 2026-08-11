# Plugin

Plugin 可以为 SpiderByte 添加本地 Skill、Agent、命令、Hook 和 MCP server 声明。Plugin 是可选的，可以从显式本地路径或 registry 加载；安装 Plugin 不会授予 SpiderByte 托管服务访问权。

## Plugin 结构

Plugin 是包含以下任一 manifest 的目录或归档：

```text
<plugin-root>/spiderbyte.plugin.json
<plugin-root>/.spiderbyte-plugin/plugin.json
```

两者同时存在时，优先使用 `spiderbyte.plugin.json`。

```json
{
  "name": "example-tools",
  "version": "1.0.0",
  "description": "Local development helpers",
  "skills": "./skills/",
  "commands": "./commands/",
  "mcpServers": {
    "local-tools": {
      "command": "node",
      "args": ["./server.mjs"]
    }
  }
}
```

解析后的所有路径都必须位于 Plugin 根目录内。manifest 还可以声明 `agents`、`hooks`、`systemPrompt` 和 `systemPromptPath`。不支持的字段会记录诊断并忽略。

## Skill 和命令

Skill 使用与项目 Skill 相同的 `SKILL.md` 格式。命令是 manifest 声明的 `commands` 目录下的 Markdown 文件，以 Plugin 命名空间调用，例如 `/example-tools:report`。

```text
example-tools/
├── spiderbyte.plugin.json
├── skills/
│   └── using-example-tools/SKILL.md
└── commands/
    └── report.md
```

命令正文可以使用 `$ARGUMENTS`。Plugin 归档中的提示词和示例应保持供应商中立，不要包含密钥。

## MCP server 和 Hook

MCP server 以本地子进程运行，或连接到显式配置的 HTTP 端点。新会话或执行 `/reload` 后启动，也可以在 Plugin 面板中单独禁用。

Hook 只在对应 Plugin 启用时运行，应按当前用户权限级别对待。尽量让 Hook 命令位于 Plugin 根目录内。

## 安装和检查

在 TUI 中使用 `/plugins` 查看已安装 Plugin、诊断和启用状态。安装时使用明确的本地路径或用户选择的 registry URL。`SPIDERBYTE_PLUGIN_MARKETPLACE_URL` 是可选设置；Open Core 不依赖默认托管 marketplace。

## 安全模型

安装 Plugin 不会执行 command tool 或旧运行时。无效 manifest、不安全路径和缺少文件会变成诊断，不会阻止无关会话启动。启用前请检查 MCP 命令、Hook、网络 URL 和 prompt 指令。

托管目录、商业数据源、桌面控制服务、托管 Worker、计费和托管审批路由不属于 Open Core Plugin。兼容扩展需要在 Open Core 包依赖图之外维护。
