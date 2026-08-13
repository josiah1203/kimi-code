# 配置覆盖

SpiderByte 有三层配置：TOML 文件、命令行选项和显式环境变量。每层都有明确的作用范围，不存在一条适用于所有字段的统一优先级规则。

- TOML 文件保存持久的本地偏好。
- 命令行选项只对本次启动生效。
- 环境变量用于移动数据目录、选择环境模型，或启用有文档说明的运行开关。

## 优先级

普通运行设置中，命令行选项优先于用户配置文件。环境变量只覆盖文档明确列出的字段。供应商凭证不会从任意 shell 变量自动获取。

供应商凭证按以下顺序解析：

1. `[providers.<name>].secret_ref` 指向的加密材料，或仅限当前进程的 `SPIDERBYTE_MODEL_API_KEY` 覆盖。
2. 旧版 `[providers.<name>].api_key` 或 `[providers.<name>.env]` 中的凭据会在启动时迁移（前提是 secret-store 密钥可用）。
3. `[providers.<name>.env]` 中对应的非敏感端点值和 `base_url`。
4. 稳定的凭证缺失或端点缺失错误。

`[providers.<name>.env]` 仍然属于 `config.toml`，不会修改 shell 环境。新的持久化凭据应使用 `spyderbyte configure` 或供应商导入命令。

一次性的 `SPIDERBYTE_MODEL_*` 通道会为当前进程创建内存中的模型和供应商，适合冒烟测试和 BYOK，不会写入磁盘。

## 命令行选项

| 选项 | 作用 |
| --- | --- |
| `-S, --session [id]` | 恢复会话或打开会话选择器。 |
| `-c, --continue` | 恢复当前目录最近的会话。 |
| `-y, --yolo` | 自动批准普通工具调用。 |
| `--auto` | 以完全自主的权限模式启动。 |
| `--plan` | 以 Plan mode 启动。 |
| `-m, --model <model>` | 为本次启动选择模型别名。 |
| `-p, --prompt <prompt>` | 执行一条提示词后退出。 |
| `--output-format <format>` | Prompt mode 使用 `text` 或 `stream-json`。 |
| `--skills-dir <dir>` | 替换本次启动发现的 Skill 目录。 |

`--output-format` 必须配合 `-p`；`--continue` 和 `--session` 不能同时使用；非交互模式下 `--yolo`/`--plan` 的组合遵循 CLI 参数校验规则。

## 隔离本地环境

测试或需要独立配置的项目可以使用单独的数据根目录：

```sh
SPIDERBYTE_HOME="$PWD/.spiderbyte-sandbox" spyderbyte --version
```

临时使用 BYOK 模型时，可以使用环境覆盖：

```sh
SPIDERBYTE_MODEL_NAME=your-local-model \
SPIDERBYTE_MODEL_PROVIDER_TYPE=openai \
SPIDERBYTE_MODEL_BASE_URL=http://127.0.0.1:11434/v1 \
SPIDERBYTE_MODEL_API_KEY=local \
spyderbyte -p "Describe the current directory"
```

## 下一步

- [配置文件](./config-files.md)
- [环境变量](./env-vars.md)
- [供应商和模型](./providers.md)
