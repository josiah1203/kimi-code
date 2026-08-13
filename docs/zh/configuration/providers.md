# 供应商和模型

SpiderByte 将供应商连接和模型别名分开管理。供应商描述线协议适配器、端点和 BYOK 凭据；模型描述发给上游的模型名称及其本地能力元数据。持久化的供应商记录只包含不透明的 `secret_ref`；原始密钥只会在出站请求边界解析。

## 支持的适配器类型

| 类型 | 协议 | 常见用途 |
| --- | --- | --- |
| `anthropic` | Anthropic Messages | Anthropic-compatible 端点。 |
| `openai` | OpenAI Chat Completions | OpenAI-compatible 服务、网关和本地服务。 |
| `openai_responses` | OpenAI Responses | Responses 协议服务。 |
| `google-genai` | Google GenAI | Google-compatible 模型端点。 |
| `vertexai` | Google GenAI on Vertex | Google Cloud Vertex AI。 |

供应商名称和端点由用户配置。Open Core 不添加 SpiderByte 托管供应商或托管身份路径。

## 配置连接

交互式供应商命令可以编辑本地供应商和模型记录：

```sh
spyderbyte provider --help
```

也可以直接编辑 `config.toml`（无需凭据时）：

```toml
[providers.local]
type = "openai"
base_url = "http://127.0.0.1:11434/v1"

[models.local]
provider = "local"
model = "your-local-model"
max_context_size = 32768
capabilities = ["tool_use"]
```

## Provider CLI 连接

平台运行时也可以通过 REST/SDK 平台契约接受显式的 `provider-cli` 连接。其
`metadata.provider_command` 使用下划线字段，并且必须包含仅使用 argv 的
`run_args`；将 `metadata.model` 设置为需要由策略授权的模型：

```json
{
  "provider": "provider-cli",
  "secret_ref": "secret_none",
  "metadata": {
    "model": "your-model",
    "provider_command": {
      "executable": "/absolute/path/to/provider-cli",
      "version_args": ["version", "--json"],
      "models_args": ["models", "--json"],
      "run_args": ["run", "--json", "--model", "{model}"],
      "input": "jsonl",
      "models_output": "json"
    }
  }
}
```

连接在本地 SpiderByte 进程中运行。如果供应商 CLI 需要保存的凭据，请配置
`provider_command.auth_env`，并通过带凭据的设置命令创建连接；凭据只会注入
子进程，绝不会写入 metadata。Provider CLI 连接支持纯文本模型请求。由于通用
命令契约不表示工具调用或结构化响应格式，这两类请求会被明确拒绝。

配置 BYOK 网关时，请设置 `SPIDERBYTE_SECRET_STORE_KEY`，并使用 `spyderbyte configure --api-key-env <name>` 或供应商导入命令。命令只临时接收密钥，持久化的是加密材料及其不透明引用。`SPIDERBYTE_MODEL_API_KEY` 仅作用于当前进程，不会写入 `config.toml`。缺少密钥或端点时会返回配置错误，不会切换到其他供应商。

## 供应商发现

SpiderByte 可以在用户显式选择后，从模型目录或本地自定义 registry 导入模型元数据。发现功能是可选的；干净的本地安装可以只使用静态 `providers` 和 `models` 记录，不需要网络。

目录元数据可以提供上下文长度和能力建议，但本地配置仍然是最终依据。网关行为不同于目录时，可以使用模型 `overrides`。

## 外部供应商适配器

发行包可能包含外部供应商协议适配器。其中的名称、模型标识符和线协议请求头属于技术兼容数据，不代表 SpiderByte 产品身份。适配器只能使用用户显式配置的端点和凭据。

SpiderByte 托管身份、订阅、席位管理、计费、托管 Worker 和供应商额度属于 Open Core checkout 之外的商业能力。
