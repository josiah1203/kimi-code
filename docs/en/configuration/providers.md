# Providers and models

SpiderByte separates a provider connection from a model alias. A provider describes the wire adapter, endpoint, and BYOK credential; a model describes the upstream model name and its local capability metadata. Persisted provider records contain an opaque `secret_ref`; raw key material is resolved only for an outbound request.

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

For deterministic setup without credentials, edit `config.toml` directly:

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

## Provider CLI connections

The platform runtime also accepts an explicit `provider-cli` connection through
the REST/SDK platform contract. Its `metadata.provider_command` uses
snake-case fields and must contain an argv-only `run_args` definition; set
`metadata.model` to the model that policy will authorize:

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

The connection runs on the local SpiderByte process. If the provider CLI
needs a stored credential, configure `provider_command.auth_env` and create
the connection through the secret-bearing setup command; the value is
injected only into the child process and is never stored in metadata. Provider
CLI connections support text-only model requests. Tool calls and structured
response formats are rejected explicitly because they are not represented by
the common command contract.

For a BYOK gateway, set `SPIDERBYTE_SECRET_STORE_KEY` and use `spyderbyte configure --api-key-env <name>` or the provider import command. Those commands accept the key transiently and persist only an encrypted secret plus its opaque reference. `SPIDERBYTE_MODEL_API_KEY` remains a process-local environment overlay; it is not written to `config.toml`. A missing key or endpoint returns a configuration error; it does not switch to another provider.

## Provider discovery

SpiderByte can import model metadata from a user-selected catalog or a local custom registry when those integrations are enabled. Discovery is optional. A clean local installation can use static `providers` and `models` records without network access.

Catalog metadata may suggest context lengths and capabilities, but the local configuration remains authoritative. Use model `overrides` when a gateway differs from the catalog.

## External provider adapters

The distribution may contain adapters for external provider protocols. Their names, model identifiers, and wire-specific headers are technical compatibility data, not SpiderByte product identity. The adapters receive only the endpoint and credentials explicitly configured by the user.

Hosted SpiderByte identity, subscriptions, seat management, billing, managed workers, and provider quotas are commercial capabilities outside this Open Core checkout.
