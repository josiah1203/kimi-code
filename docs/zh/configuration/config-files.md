# 配置文件

SpiderByte 使用 TOML 保存本地、无账号运行所需的配置。配置文件负责选择供应商和模型、限制 Agent 运行循环，并定义本地权限策略；不需要 SpiderByte 托管账号。

默认目录是 `~/.spiderbyte`。可以通过 `SPIDERBYTE_HOME` 修改位置：

```sh
export SPIDERBYTE_HOME=/path/to/spiderbyte-home
```

主配置文件是 `$SPIDERBYTE_HOME/config.toml`，终端界面偏好单独保存在 `$SPIDERBYTE_HOME/tui.toml`。

## 本地/BYOK 示例

下面的示例连接到本地 OpenAI-compatible 服务。请根据自己控制的服务或自己拥有 API 密钥的供应商，替换端点、密钥和模型。

```toml
default_model = "local"
default_permission_mode = "manual"
default_plan_mode = false
telemetry = false

[providers.local]
type = "openai"
base_url = "http://127.0.0.1:11434/v1"
api_key = "local"

[models.local]
provider = "local"
model = "your-local-model"
max_context_size = 32768
capabilities = ["thinking", "tool_use"]

[thinking]
enabled = true
effort = "medium"
keep = "all"

[loop_control]
max_steps_per_turn = 100
max_attempts_per_step = 3
reserved_context_size = 4096

[[permission.rules]]
decision = "allow"
pattern = "Read"

[[permission.rules]]
decision = "deny"
pattern = "Bash(rm -rf*)"
```

供应商类型选择线协议适配器。`base_url` 可以指向 localhost、自托管网关，或使用你自己密钥的供应商端点。SpiderByte 不提供托管密钥、托管身份、计费或使用额度服务。

## 顶层字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `default_model` | `string` | 新会话使用的模型别名，必须存在于 `[models]`。 |
| `default_permission_mode` | `string` | `manual`、`auto` 或 `yolo`；默认是更安全的 `manual`。 |
| `default_plan_mode` | `boolean` | 为 `true` 时，新会话默认进入 Plan mode。 |
| `merge_all_available_skills` | `boolean` | 是否合并配置的 Skill 目录。 |
| `extra_skill_dirs` | `array<string>` | 额外 Skill 目录。 |
| `extra_agent_dirs` | `array<string>` | 额外 Agent 定义目录。 |
| `telemetry` | `boolean` | 是否启用本地事件收集和显式配置的输出；完全本地运行时可设为 `false`。 |
| `providers` | table | 供应商连接记录。 |
| `models` | table | 模型别名和能力。 |
| `thinking` | table | Thinking 默认值。 |
| `loop_control` | table | 步数、重试和压缩限制。 |
| `background` | table | 后台任务限制。 |
| `tools` | table | 全局工具开关。 |
| `image` | table | 图片压缩限制。 |
| `permission` | table | 初始本地权限规则。 |
| `hooks` | array of tables | 本地生命周期 Hook。 |
| `identity` | table | 可选的本地 Agent 身份元数据。 |

未知字段会被记录为配置诊断。编辑后运行 `spyderbyte doctor` 检查文件。

## 供应商

每个 `[providers.<name>]` 记录描述一个供应商连接。凭据只从记录或显式的 `env` 表读取；CLI 不会静默获取 SpiderByte 托管令牌。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | `string` | 线协议/供应商适配器，例如 `openai`、`openai_responses`、`anthropic`、`google-genai`、`vertexai` 或已安装的适配器。 |
| `api_key` | `string` | 此连接使用的 API 密钥。不要提交到 Git。 |
| `base_url` | `string` | 端点覆盖值，可以是 localhost 或自托管端点。 |
| `default_model` | `string` | 供应商级默认模型。 |
| `env` | table of strings | `api_key` 和 `base_url` 的显式备用值。 |
| `custom_headers` | table of strings | 发给该供应商的请求头。 |
| `oauth` | table | 外部供应商适配器支持的令牌引用；这不是 SpiderByte 账号登录。 |

BYOK 连接应放在被 Git 忽略的文件中，或使用 `SPIDERBYTE_MODEL_*` 环境覆盖。示例、测试和 issue 内容中不要放真实密钥。

```toml
[providers.gateway]
type = "openai"
base_url = "https://api.example.test/v1"

[providers.gateway.env]
SPIDERBYTE_API_KEY = "YOUR_API_KEY"
SPIDERBYTE_BASE_URL = "https://api.example.test/v1"
```

`api_key` 的优先级高于供应商 `env` 表。缺少密钥或端点时，系统会返回稳定的供应商配置错误，不会静默切换到其他服务。

## 模型

每个 `[models.<alias>]` 记录指向一个供应商，并指定发到上游的模型标识符。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `provider` | `string` | 供应商记录名。 |
| `model` | `string` | 上游模型标识符。 |
| `max_context_size` | `integer` | 最大上下文长度。 |
| `max_input_size` | `integer` | 可选的单次输入限制。 |
| `max_output_size` | `integer` | 可选的输出 token 限制。 |
| `capabilities` | `array<string>` | `thinking`、`image_in`、`video_in`、`tool_use` 等能力标签。 |
| `support_efforts` | `array<string>` | 支持的 thinking effort 值。 |
| `default_effort` | `string` | 此模型的默认 thinking effort。 |
| `off_effort` | `string` | 供应商要求关闭 Thinking 时使用的线协议值。 |
| `base_url` | `string` | 模型级端点覆盖值。 |
| `display_name` | `string` | CLI 中显示的名称。 |
| `reasoning_key` | `string` | OpenAI-compatible 网关使用的非标准 reasoning 字段名。 |
| `adaptive_thinking` | `boolean` | 为兼容的适配器启用或关闭自适应 Thinking。 |

如果模型目录会刷新，而某些字段必须保留，可以使用 `[models."<alias>".overrides]`：

```toml
[models.local]
provider = "local"
model = "your-local-model"
max_context_size = 32768

[models.local.overrides]
max_output_size = 8192
display_name = "本地开发模型"
```

## Thinking 和运行循环

```toml
[thinking]
enabled = true
effort = "high"
keep = "all"

[loop_control]
max_steps_per_turn = 100
max_attempts_per_step = 3
reserved_context_size = 4096
```

省略 `max_steps_per_turn` 或设为 `0` 表示不设置显式步数上限。重试只适用于临时供应商故障；权限拒绝、请求无效、凭据缺失或能力不支持不会重试。

## 本地服务、策略和 Hook

SpiderByte 支持的网页抓取路径是本地实现，并使用带私有地址保护的标准网络栈。托管搜索、托管抓取、托管 Worker、计费和账号服务不属于本仓库。如果部署确实需要这些能力，应安装并配置独立扩展；Open Core 包不会导入这些实现。

权限规则在工具执行前本地评估。Hook 是本地进程，应按与 SpiderByte 相同的权限级别对待。

```toml
[[hooks]]
event = "PreToolUse"
matcher = "Bash"
command = "node .spiderbyte/hooks/check-bash.mjs"
timeout = 5
```

## 迁移和兼容性

受支持的数据目录是 `.spiderbyte`。旧产品目录和旧引擎开关不属于活动运行时。迁移旧配置时，只把自己理解的字段复制到新文件，然后运行 `spyderbyte doctor`；不要依赖自动托管账号迁移。
