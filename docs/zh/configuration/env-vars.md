# 环境变量

环境变量是本地配置的显式覆盖，适合 CI、隔离的冒烟测试和 BYOK 供应商设置。SpiderByte 不会因为存在某个环境变量，就联系 SpiderByte 托管服务。

## 数据目录和供应商选择

| 变量 | 用途 |
| --- | --- |
| `SPIDERBYTE_HOME` | 修改本地数据和配置目录。 |
| `SPIDERBYTE_MODEL_NAME` | 为当前进程添加内存中的模型别名。 |
| `SPIDERBYTE_MODEL_PROVIDER_TYPE` | 设置环境模型使用的供应商适配器。 |
| `SPIDERBYTE_MODEL_API_KEY` | 提供环境模型的 API 密钥。 |
| `SPIDERBYTE_MODEL_BASE_URL` | 提供环境模型端点；没有默认端点的适配器必须设置。 |
| `SPIDERBYTE_MODEL_MAX_CONTEXT_SIZE` | 覆盖环境模型的上下文限制。 |
| `SPIDERBYTE_MODEL_MAX_OUTPUT_SIZE` | 覆盖输出限制。 |
| `SPIDERBYTE_MODEL_CAPABILITIES` | 逗号分隔的能力标签。 |
| `SPIDERBYTE_MODEL_TEMPERATURE` | 设置 temperature。 |
| `SPIDERBYTE_MODEL_TOP_P` | 设置 nucleus sampling 值。 |
| `SPIDERBYTE_MODEL_THINKING_KEEP` | 控制是否保留 reasoning 内容。 |
| `SPIDERBYTE_MODEL_THINKING_EFFORT` | 设置模型的 thinking effort。 |
| `SPIDERBYTE_MODEL_REASONING_KEY` | 为兼容网关选择非标准 reasoning 字段。 |

示例：

```sh
SPIDERBYTE_MODEL_NAME=your-local-model \
SPIDERBYTE_MODEL_PROVIDER_TYPE=openai \
SPIDERBYTE_MODEL_BASE_URL=http://127.0.0.1:11434/v1 \
SPIDERBYTE_MODEL_API_KEY=local \
spyderbyte
```

环境覆盖只在当前进程生效，不会写回 `config.toml`。需要持久化时，请使用供应商记录。

## 运行控制

| 变量 | 用途 |
| --- | --- |
| `SPIDERBYTE_LOOP_MAX_STEPS_PER_TURN` | 单轮最大步数。 |
| `SPIDERBYTE_LOOP_MAX_ATTEMPTS_PER_STEP` | 失败步骤的总尝试次数。 |
| `SPIDERBYTE_LOOP_MAX_RETRIES_PER_STEP` | 尝试次数限制的已弃用别名。 |
| `SPIDERBYTE_SECONDARY_MODEL` | 启用该功能后，次级 Agent 使用的模型别名。 |
| `SPIDERBYTE_SECONDARY_EFFORT` | 次级模型的 thinking effort。 |
| `SPIDERBYTE_EXPERIMENTAL_FLAG` | 为开发运行启用所有实验功能。 |
| `SPIDERBYTE_EXPERIMENTAL_SECONDARY_MODEL` | 启用次级模型选择。 |
| `SPIDERBYTE_DISABLE_CRON` | 禁用本地定时自动化。 |
| `SPIDERBYTE_DISABLE_PLATFORM_SERVICES` | 禁用可选的本地平台服务。 |
| `SPIDERBYTE_TUI_NO_RENDER_CACHE` | 禁用终端渲染缓存。 |
| `SPIDERBYTE_STATUS_LINE` | 设置外部状态栏命令。 |

## 日志和诊断

| 变量 | 用途 |
| --- | --- |
| `SPIDERBYTE_LOG_LEVEL` | 设置日志级别。 |
| `SPIDERBYTE_LOG_SESSION_FILES` | 启用会话日志文件。 |
| `SPIDERBYTE_LOG_GLOBAL_FILES` | 启用进程级日志文件。 |
| `SPIDERBYTE_DEBUG` | 启用更多本地诊断信息。 |
| `SPIDERBYTE_STARTUP_TRACE` | 写入启动耗时信息。 |
| `SPIDERBYTE_ERROR_INFO` | 请求扩展的启动错误信息。 |

日志写入 `SPIDERBYTE_HOME` 下的目录。分享之前应检查其中是否包含密钥或个人信息。

## Plugin、MCP 和更新

| 变量 | 用途 |
| --- | --- |
| `SPIDERBYTE_PLUGIN_ROOT` | 传给 Plugin 子进程的根目录。 |
| `SPIDERBYTE_PLUGIN_MARKETPLACE_URL` | 显式指定的 Plugin 目录 URL 或本地路径。空值不会启用默认托管目录。 |
| `SPIDERBYTE_MCP_STARTUP_TIMEOUT_MS` | MCP 启动超时。 |
| `SPIDERBYTE_MCP_TOOL_TIMEOUT_MS` | MCP 工具调用超时。 |
| `SPIDERBYTE_CLI_NO_AUTO_UPDATE` | 禁用 CLI 更新检查。 |
| `SPIDERBYTE_NO_AUTO_UPDATE` | 禁用更新检查的兼容别名。 |
| `SPIDERBYTE_CDN_LATEST_URL` | 开启更新检查时使用的显式元数据 URL。 |

远程 Plugin 目录和更新端点都是可选集成，不是本地无账号运行的依赖。

## 安全提示

不要提交 API 密钥、OAuth 令牌、Bearer 令牌或签名 URL。文档和测试中使用 `YOUR_API_KEY`。CI 使用 CI 密钥存储，并明确设置供应商端点。可选能力缺失时必须返回文档化错误，不得回退到旧产品路径。
