# `spyderbyte` 命令

`spyderbyte` 启动本地 SpiderByte 终端 Agent。它使用 SpiderByte Agent Core，将会话保存在 `SPIDERBYTE_HOME` 下，并接受本地或 BYOK 供应商配置。

```sh
spyderbyte [options]
spyderbyte <subcommand> [options]
```

## 主命令选项

| 选项 | 简写 | 说明 |
| --- | --- | --- |
| `--version` | `-V` | 打印版本并退出。 |
| `--help` | `-h` | 打印帮助。 |
| `--session [id]` | `-S` | 恢复会话或打开会话选择器。 |
| `--continue` | `-c` | 恢复当前目录最近的会话。 |
| `--model <model>` | `-m` | 为本次启动选择模型别名。 |
| `--prompt <prompt>` | `-p` | 不打开 TUI，执行一条提示词。 |
| `--output-format <format>` | | Prompt mode 使用 `text` 或 `stream-json`。 |
| `--yolo` | `-y` | 自动批准普通工具调用。 |
| `--auto` | | 以完全自主的权限模式启动。 |
| `--plan` | | 以 Plan mode 启动。 |
| `--skills-dir <dir>` | | 替换本次启动发现的 Skill 目录。 |
| `--agent <name>` | | 选择已发现的 Agent profile。 |
| `--agent-file <path>` | | 从文件选择 Agent 定义。 |
| `--add-dir <dir>` | | 为本次会话添加工作目录。 |

`--continue` 和 `--session` 互斥。`--output-format` 必须配合 `--prompt`；Prompt mode 不能同时使用 `--yolo`、`--auto` 或 `--plan`。

## 示例

```sh
spyderbyte
spyderbyte --continue
spyderbyte --session 01HZ...XYZ
spyderbyte -p "Summarize the current repository status"
spyderbyte -p "List changed files" --output-format stream-json
spyderbyte --plan
```

## 子命令

| 命令 | 用途 |
| --- | --- |
| `spyderbyte configure` | 创建本地供应商连接和模型选择。 |
| `spyderbyte auth status` | 报告无账号本地认证状态。 |
| `spyderbyte run <prompt>` | 通过规范 harness 执行一条受治理提示词。 |
| `spyderbyte provider` | 列出、添加、删除或发现供应商记录。 |
| `spyderbyte connections` | 列出工作区的本地供应商连接。 |
| `spyderbyte usage` | 显示本地工作区使用记录。 |
| `spyderbyte plugins` | 列出本地已安装 Plugin。 |
| `spyderbyte organization` | 创建、列出和选择本地组织。 |
| `spyderbyte project` | 创建、列出和选择本地项目。 |
| `spyderbyte workspace` | 列出和选择本地工作区。 |
| `spyderbyte acp` | 通过标准输入/输出运行本地 ACP server。 |
| `spyderbyte web` | 运行本地 REST/WebSocket server；浏览器客户端不在此 checkout 中。 |
| `spyderbyte doctor` | 校验 `config.toml` 和 `tui.toml`。 |
| `spyderbyte export` | 导出本地会话归档。 |
| `spyderbyte upgrade` | 更新功能开启时执行更新检查。 |

`configure`、组织、项目、工作区、连接、使用量和 Plugin 命令都操作本地持久化数据，不会创建托管租户、付费权益、发票或托管 Worker。

### `spyderbyte configure`

```sh
spyderbyte configure \
  --provider local \
  --model your-local-model \
  --base-url http://127.0.0.1:11434/v1 \
  --no-credentials
```

BYOK 连接可以把密钥放在 `--api-key-env` 指定的环境变量中，避免将密钥写入 argv。只有在配置阶段无法访问端点时才使用 `--skip-validation`。

### `spyderbyte auth status`

```sh
spyderbyte auth status --json
```

结果会标识本地模式并说明托管身份已排除，不会联系账号服务。

### `spyderbyte provider`

```sh
spyderbyte provider list
spyderbyte provider add https://registry.example.test/api.json --api-key YOUR_API_KEY
spyderbyte provider catalog list
spyderbyte provider catalog add openai --default-model your-model
spyderbyte provider remove local
```

目录和 registry 命令是可选网络集成。它们不可用时，静态本地配置仍然可以使用。

### `spyderbyte web`

```sh
spyderbyte web --no-open
spyderbyte web --port 58627 --host 127.0.0.1
spyderbyte web rotate-token
```

Server 默认只绑定 loopback，提供本地 REST 和 WebSocket 合约。权威浏览器源码由外部 code-app 项目维护；本仓库不携带无法复现的生成 bundle。

### `spyderbyte doctor`

```sh
spyderbyte doctor
spyderbyte doctor config ./config.toml
spyderbyte doctor tui ./tui.toml
```

默认文件不存在时会跳过检查，因为可以使用内置默认值；显式传入的路径必须存在且能成功解析。

### `spyderbyte export`

```sh
spyderbyte export -y
spyderbyte export <session-id> -o ./session-export.zip --no-include-global-log
```

分享之前请检查归档中的代码、命令输出、文件路径和日志。

## Open Core 范围

Open Core 包含本地组织、项目、工作区、会话、Run、制品、策略、预算、审批、使用量记录、供应商中立的执行合约、CLI/TUI、REST/WebSocket 合约、ACP、SDK，以及不依赖托管服务即可工作的 Klient 功能。托管身份、计费、订阅、托管供应商、托管 Worker、Slack/Teams 集成和托管审批路由明确排除在外。
