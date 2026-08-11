# SpiderByte Open Core

SpiderByte 是一个本地、供应商中立的 Agent 平台。规范可执行文件名是
`spyderbyte`，规范运行时是 SpiderByte Agent Core。

本仓库包含可自托管的 Open Core：本地工作区、会话、Run、制品、策略、
预算、供应商连接、CLI/TUI、REST/WebSocket 契约、SDK、MCP 和 ACP。本仓库
不包含托管身份、计费、托管供应商代理、托管 Worker、Slack/Teams 集成或
Business/Enterprise 部署服务。

## 本地快速开始

环境要求：Node.js >= 24.15.0，pnpm 10.33.0。

```sh
git clone https://github.com/SpiderByte/spiderbyte.git
cd spiderbyte
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @spiderbyte/cli run build
node apps/cli/dist/main.mjs --version
```

在项目目录中启动本地 CLI/TUI：

```sh
spyderbyte
```

使用 `spyderbyte configure` 配置本地或 BYOK 供应商。本地模式不需要
SpiderByte 托管账号。本仓库提供本地服务 API；浏览器 UI 源码在外部仓库
维护，因此不会发布无法从本仓库重现的前端 bundle。

## 开发命令

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm run check:open-core
pnpm run check:branding
pnpm run verify:open-core-local
```

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)、[Open Core 边界](docs/architecture/OPEN_CORE_BOUNDARY.md)
以及[发布迁移计划](docs/release/SPIDERBYTE_OPEN_CORE_MIGRATION_PLAN.md)。

## 许可证与安全

SpiderByte Open Core 使用 [MIT 许可证](LICENSE) 发布。归属信息见
[NOTICE](NOTICE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，安全问题请参阅
[SECURITY.md](SECURITY.md)。
