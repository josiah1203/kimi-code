# Providers and models

SpiderByte separates a provider connection from a model alias. A provider describes the wire adapter, endpoint, and BYOK credential; a model describes the upstream model name and its local capability metadata.

## Supported adapter types

| Type | Protocol | Typical use |
| --- | --- | --- |
| `anthropic` | Anthropic Messages | Anthropic-compatible endpoints. |
| `openai` | OpenAI Chat Completions | OpenAI-compatible services, gateways, and local servers. |
| `openai_responses` | OpenAI Responses | Services exposing the Responses protocol. |
| `google-genai` | Google GenAI | Google-compatible model endpoints. |
| `vertexai` | Google GenAI on Vertex | Google Cloud Vertex AI. |

Provider names and endpoints are user configuration. Open Core does not add a managed SpiderByte provider or a hosted identity path.

## Configure a connection

The interactive provider command edits local provider and model records:

```sh
spyderbyte provider --help
```

For deterministic setup, edit `config.toml` directly:

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

For a BYOK gateway, replace the endpoint and keep the key in a local ignored file or an environment overlay. A missing key or endpoint returns a configuration error; it does not switch to another provider.

## Provider discovery

SpiderByte can import model metadata from a user-selected catalog or a local custom registry when those integrations are enabled. Discovery is optional. A clean local installation can use static `providers` and `models` records without network access.

Catalog metadata may suggest context lengths and capabilities, but the local configuration remains authoritative. Use model `overrides` when a gateway differs from the catalog.

## External provider adapters

The distribution may contain adapters for external provider protocols. Their names, model identifiers, and wire-specific headers are technical compatibility data, not SpiderByte product identity. The adapters receive only the endpoint and credentials explicitly configured by the user.

Hosted SpiderByte identity, subscriptions, seat management, billing, managed workers, and provider quotas are commercial capabilities outside this Open Core checkout.
