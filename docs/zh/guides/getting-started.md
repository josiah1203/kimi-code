# 开始使用

SpiderByte CLI 是一个本地终端 Agent，用于检查和修改项目、在显式审批下运行工具，并把会话持久化到本地磁盘。Open Core 发行版支持无账号运行，也支持本地模型或 BYOK 供应商。

## 环境要求

- Node.js `24.15.0` 或更高版本
- 从 checkout 构建时使用 pnpm `10.33.0`
- 一个本地模型服务，或你选择的供应商 API 密钥

## 从干净 checkout 运行

```sh
git clone https://github.com/SpiderByte/spiderbyte.git
cd spiderbyte
corepack enable
pnpm install --frozen-lockfile
pnpm run build:packages
pnpm --filter @spiderbyte/cli run build
node apps/cli/dist/main.mjs --version
```

开发时可以使用 CLI 的源码启动器：

```sh
pnpm --filter @spiderbyte/cli run dev:cli-only
```

发布后可以安装发行包：

```sh
npm install -g @spiderbyte/cli
spyderbyte --version
```

从 checkout 构建不需要安装脚本、托管账号或托管凭据。

## 配置供应商

在 `$SPIDERBYTE_HOME/config.toml`（默认是 `~/.spiderbyte/config.toml`）中写入本地或 BYOK 连接：

```toml
default_model = "local"
telemetry = false

[providers.local]
type = "openai"
base_url = "http://127.0.0.1:11434/v1"

[models.local]
provider = "local"
model = "your-local-model"
max_context_size = 32768
capabilities = ["tool_use"]
```

使用 `spyderbyte doctor` 校验配置。BYOK 凭据请设置 `SPIDERBYTE_SECRET_STORE_KEY`，并使用 `spyderbyte configure --api-key-env <name>` 配置。一次性运行可以使用 [环境变量](../configuration/env-vars.md) 中介绍的 `SPIDERBYTE_MODEL_*` 变量。

## 启动会话

在项目目录中运行：

```sh
spyderbyte
```

执行一条非交互提示词：

```sh
spyderbyte -p "Describe this project's directory structure"
```

恢复最近的会话：

```sh
spyderbyte --continue
```

第一次启动会在配置的数据目录下创建本地会话和配置数据。TUI 在执行可能造成破坏的工具前会请求审批。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `/new` | 开始新会话。 |
| `/sessions` | 浏览并恢复会话。 |
| `/model` | 切换当前模型。 |
| `/compact` | 压缩当前上下文。 |
| `/fork` | 创建会话的独立副本。 |
| `/help` | 打开命令和快捷键帮助。 |
| `/exit` | 退出 TUI。 |

使用 `spyderbyte provider --help` 管理本地供应商记录，使用 `spyderbyte export` 创建可审查的会话归档。

## IDE 集成

本地 ACP 适配器通过以下命令启动：

```sh
spyderbyte acp
```

IDE 配置见[在 IDE 中使用 SpiderByte CLI](./ides.md)。ACP 使用本地 CLI 进程的供应商配置，不执行 SpiderByte 托管登录。

## 数据和商业边界

运行时数据保存在 `SPIDERBYTE_HOME` 下，包括配置、会话记录、策略、制品、日志和可选的外部供应商令牌记录。详见[数据路径](../configuration/data-locations.md)。

托管身份、订阅、计费、托管 Worker、托管审批路由和托管供应商服务属于本 checkout 之外的商业能力，不是本地平台的运行前提。
