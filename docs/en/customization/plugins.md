# Plugins

Plugins extend SpiderByte with local Skills, agents, commands, hooks, and MCP server declarations. They are optional packages loaded from an explicit local path or registry; installing one never grants hosted SpiderByte access.

## Plugin layout

A plugin is a directory or archive containing one of these manifests:

```text
<plugin-root>/spiderbyte.plugin.json
<plugin-root>/.spiderbyte-plugin/plugin.json
```

`spiderbyte.plugin.json` takes precedence when both exist.

```json
{
  "name": "example-tools",
  "version": "1.0.0",
  "description": "Local development helpers",
  "skills": "./skills/",
  "commands": "./commands/",
  "mcpServers": {
    "local-tools": {
      "command": "node",
      "args": ["./server.mjs"]
    }
  }
}
```

All referenced paths must remain below the plugin root after symlink resolution. A manifest can also declare `agents`, `hooks`, `systemPrompt`, and `systemPromptPath`. Unsupported fields are reported as diagnostics and ignored.

## Skills and commands

Skills use the same `SKILL.md` format as project Skills. Commands are Markdown files below the declared `commands` directory and are invoked with the plugin namespace, for example `/example-tools:report`.

```text
example-tools/
├── spiderbyte.plugin.json
├── skills/
│   └── using-example-tools/SKILL.md
└── commands/
    └── report.md
```

The command body may use `$ARGUMENTS`. Keep prompts and examples provider-neutral, and do not include secrets in a plugin archive.

## MCP servers and hooks

MCP servers run as local subprocesses or connect to an explicitly configured HTTP endpoint. They start for a new session or after `/reload`; they can be disabled independently from the plugin panel.

Hooks run only while their plugin is enabled. Treat them as executable code with the privileges of the current user. Keep hook commands inside the plugin root whenever possible.

## Install and inspect

Use `/plugins` in the TUI to inspect installed plugins, diagnostics, and enabled state. Use an explicit local path or a user-selected registry URL when installing. `SPIDERBYTE_PLUGIN_MARKETPLACE_URL` is optional; no default hosted marketplace is required for Open Core.

## Security model

Plugin installation does not execute command tools or legacy runtimes. Invalid manifests, unsafe paths, and missing files become diagnostics without preventing unrelated sessions from starting. Review MCP commands, hooks, network URLs, and prompt instructions before enabling a plugin.

Hosted catalogs, commercial data sources, desktop-control services, managed workers, billing, and hosted approval routing are not shipped as Open Core plugins. A compatible extension must be maintained outside the Open Core package graph.
