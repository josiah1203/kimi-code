# 在 IDE 中使用 SpiderByte CLI

SpiderByte CLI 通过 [Agent Client Protocol（ACP）](https://agentclientprotocol.com/) 集成 IDE。IDE 启动本地 `spyderbyte acp` 进程，并通过标准输入/输出上的 JSON-RPC 与它通信。

## 前置条件

安装并构建 SpiderByte CLI，配置本地或 BYOK 供应商，然后检查可执行文件：

```sh
spyderbyte --version
spyderbyte doctor
```

ACP 使用 IDE 启动进程的配置和凭据，不执行托管账号登录。

## Zed

将以下内容加入 `~/.config/zed/settings.json`：

```json
{
  "agent_servers": {
    "SpiderByte CLI": {
      "type": "custom",
      "command": "spyderbyte",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

如果 IDE 进程的 `PATH` 中没有 `spyderbyte`，请把 `command` 改为绝对路径。新建 Zed Agent 会话后，IDE 会启动本地 ACP 子进程。IDE 声明的 MCP server 会在传输类型受支持时通过 ACP 转发。

## JetBrains IDE

在 AI Chat 面板中选择 **Configure ACP agents**，加入：

```json
{
  "agent_servers": {
    "SpiderByte CLI": {
      "command": "/absolute/path/to/spyderbyte",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

当 IDE 不继承终端 `PATH` 时，请使用绝对路径。

## 其他 ACP 客户端

任何兼容 ACP 的客户端都可以启动：

```sh
spyderbyte acp
```

客户端必须提供工作目录，并继承或显式设置 `SPIDERBYTE_HOME`。供应商凭据仍然只属于该本地配置。

## 排查问题

- 如果进程立即退出，请在终端运行 `spyderbyte acp` 并检查配置错误。
- 如果模型请求失败，请运行 `spyderbyte doctor`，确认供应商端点和 BYOK 凭据。
- 如果 MCP 工具不可见，请确认配置的传输类型受 ACP 适配器支持，并检查本地日志。
- 如果 IDE 找不到可执行文件，请使用绝对路径，并确认 IDE 进程可以使用相同的 Node/runtime 环境。

## 下一步

- [ACP 参考](../reference/spyderbyte-acp.md)
- [命令参考](../reference/spyderbyte-command.md)
