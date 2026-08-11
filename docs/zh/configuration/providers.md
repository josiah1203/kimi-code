# 供应商和模型

SpiderByte 将供应商连接和模型别名分开管理。供应商描述线协议适配器、端点和 BYOK 凭据；模型描述发给上游的模型名称及其本地能力元数据。

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

也可以直接编辑 `config.toml`：

```toml
[providers.local]
type = "openai"
base_url = "http://127.0.0.1:11434/v1"
api_key = "local"

[models.local]
provider = "local"
model = "your-local-model"
max_context_size = 32768
capabilities = ["tool_use"]
```

配置 BYOK 网关时，替换端点，并把密钥放入被 Git 忽略的本地文件或环境覆盖。缺少密钥或端点时会返回配置错误，不会切换到其他供应商。

## 供应商发现

SpiderByte 可以在用户显式选择后，从模型目录或本地自定义 registry 导入模型元数据。发现功能是可选的；干净的本地安装可以只使用静态 `providers` 和 `models` 记录，不需要网络。

目录元数据可以提供上下文长度和能力建议，但本地配置仍然是最终依据。网关行为不同于目录时，可以使用模型 `overrides`。

## 外部供应商适配器

发行包可能包含外部供应商协议适配器。其中的名称、模型标识符和线协议请求头属于技术兼容数据，不代表 SpiderByte 产品身份。适配器只能使用用户显式配置的端点和凭据。

SpiderByte 托管身份、订阅、席位管理、计费、托管 Worker 和供应商额度属于 Open Core checkout 之外的商业能力。
