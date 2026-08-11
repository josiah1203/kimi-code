# Using SpiderByte CLI in IDEs

SpiderByte CLI integrates with IDEs through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/). The IDE launches the local `spyderbyte acp` process and communicates with it over JSON-RPC on stdin/stdout.

## Prerequisites

Install and build SpiderByte CLI, configure a local or BYOK provider, and verify the executable:

```sh
spyderbyte --version
spyderbyte doctor
```

ACP uses the configuration and credentials of the process that the IDE starts. It does not perform hosted account login.

## Zed

Add this to `~/.config/zed/settings.json`:

```json
{
  "agent_servers": {
    "SpiderByte CLI": {
      "type": "custom",
      "command": "spyderbyte",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

If `spyderbyte` is not on the IDE process `PATH`, set `command` to its absolute path. A new Zed agent session then launches the local ACP subprocess. MCP servers declared by the IDE are forwarded through the ACP protocol when their transport is supported.

## JetBrains IDEs

In the AI Chat panel, choose **Configure ACP agents** and add:

```json
{
  "agent_servers": {
    "SpiderByte CLI": {
      "command": "/absolute/path/to/spyderbyte",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

Use an absolute path when the IDE does not inherit the terminal `PATH`.

## Other ACP clients

Any ACP-compatible client can launch:

```sh
spyderbyte acp
```

The client must provide a working directory and inherit or explicitly set `SPIDERBYTE_HOME`. Provider credentials remain local to that configuration.

## Troubleshooting

- If the process exits immediately, run `spyderbyte acp` in a terminal and inspect the configuration error.
- If a model request fails, run `spyderbyte doctor` and confirm the provider endpoint and BYOK credential.
- If MCP tools are missing, check that the configured transport is supported by the ACP adapter and inspect the local log.
- If the IDE cannot find the executable, use an absolute path and verify that the same Node/runtime environment is available to the IDE process.

## Next steps

- [ACP reference](../reference/spyderbyte-acp.md)
- [Command reference](../reference/spyderbyte-command.md)
