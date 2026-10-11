---
title: Connect your AI
description: Copy-paste, verified configuration to add the Papertrade Terminal MCP server to Claude, Codex, ChatGPT, Gemini CLI, Cursor, VS Code, Windsurf, Zed, Cline, Goose, Continue and any agent framework.
order: 6
---

# Connect your AI

Every client below connects to the same server.

| | |
| --- | --- |
| Name | `papertrade-terminal` |
| URL | `https://papertrade-terminal.pages.dev/mcp` |
| Transport | Streamable HTTP |
| Authentication | None. No API key, no OAuth. |

The server is read-only. Your assistant can look up markets, quote trades and build an unsigned plan with a link, but it cannot sign or place anything. You sign in your own wallet in the terminal. See the [MCP page](/docs/mcp/) for the nine tools.

> Unofficial, not affiliated with Papertrade. Papertrade allows up to 1000x leverage and a small move can liquidate the whole margin. Nothing here is financial advice.

Each block states what it was checked against. Client configuration changes often, so if a snippet stops working check the linked vendor docs first. Snippets were checked on 2026-10-11.

A prompt to try once connected:

```
Quote a $50 BTC long at 10x on Papertrade, show the leverage ladder, then build the trade plan and give me the link.
```

## Claude Code

Verified against code.claude.com/docs/en/mcp (the `claude mcp add --transport http <name> <url>` form and the `.mcp.json` shape).

```sh
claude mcp add --transport http papertrade-terminal https://papertrade-terminal.pages.dev/mcp
```

Add `--scope user` to make it available in every project, or `--scope project` to write it to a shared `.mcp.json`:

```json
{
  "mcpServers": {
    "papertrade-terminal": {
      "type": "http",
      "url": "https://papertrade-terminal.pages.dev/mcp"
    }
  }
}
```

Run `/mcp` inside Claude Code to confirm the server and its nine tools.

## Claude.ai and Claude Desktop (custom connector)

Verified against modelcontextprotocol.io "Connect to remote MCP Servers", which documents Settings, Connectors, Add, Add custom connector.

1. Open Settings, then Connectors.
2. Click Add, then Add custom connector.
3. Paste `https://papertrade-terminal.pages.dev/mcp`.
4. Click Add. There is no authentication step. Leave any OAuth fields empty.
5. In a chat, enable the connector from the connectors menu.

Custom connectors may need a paid plan, and on Team and Enterprise an owner adds the connector once for the organisation.

## Claude Desktop (config file with the mcp-remote bridge)

Verified against the `mcp-remote` README pattern and Claude Desktop's `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`). Use this only if you prefer a config file over the connector UI. It needs Node.js.

```json
{
  "mcpServers": {
    "papertrade-terminal": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://papertrade-terminal.pages.dev/mcp"]
    }
  }
}
```

Fully quit and restart Claude Desktop after editing.

## Claude API (MCP connector)

Verified against platform.claude.com/docs/en/agents-and-tools/mcp-connector, beta header `mcp-client-2025-11-20`. The connector is a beta feature, so check that page for a newer header (it also documents `mcp-client-2026-09-15`, which adds pinned tool listings). Set `ANTHROPIC_API_KEY` first.

```sh
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: mcp-client-2025-11-20" \
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 1500,
    "messages": [{"role": "user", "content": "Quote a $50 BTC long at 10x on Papertrade and build the trade plan."}],
    "mcp_servers": [
      {"type": "url", "url": "https://papertrade-terminal.pages.dev/mcp", "name": "papertrade-terminal"}
    ],
    "tools": [
      {"type": "mcp_toolset", "mcp_server_name": "papertrade-terminal"}
    ]
  }'
```

Every server in `mcp_servers` must be referenced by exactly one `mcp_toolset`. Replace the model with any current Claude model. No `authorization_token` is needed. To expose only some tools, add `default_config: {"enabled": false}` and a `configs` map to the toolset as described in the vendor page.

## OpenAI Codex CLI and IDE extension

Verified against the Codex MCP docs (developers.openai.com/codex/mcp). Both surfaces share `~/.codex/config.toml`.

```toml
[mcp_servers.papertrade-terminal]
url = "https://papertrade-terminal.pages.dev/mcp"
```

From the command line:

```sh
codex mcp add papertrade-terminal --url https://papertrade-terminal.pages.dev/mcp
```

The docs show `codex mcp add <name> --url <url>` with an optional `--oauth-client-id`. This server needs neither. Run `/mcp` in Codex to see the loaded tools.

## OpenAI Responses API

Verified against developers.openai.com/api/docs/guides/tools-connectors-mcp (`type: "mcp"` with `server_label`, `server_url`, `require_approval`, `allowed_tools`). Set `OPENAI_API_KEY` and pick a current model.

```sh
curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-5",
    "tools": [
      {
        "type": "mcp",
        "server_label": "papertrade_terminal",
        "server_url": "https://papertrade-terminal.pages.dev/mcp",
        "require_approval": "never"
      }
    ],
    "input": "Quote a $50 BTC long at 10x on Papertrade and build the trade plan."
  }'
```

`require_approval` defaults to asking before data is shared with the server. `never` is reasonable here because every tool is read-only, but you can keep the default. Use `allowed_tools` to limit the imported tools. The model name above is an example, check OpenAI's current model list.

## ChatGPT (developer mode)

Partly verified: the vendor docs confirm developer mode supports remote MCP apps with No authentication, and that the Create app button only appears in developer mode. Menu labels differ between plans and builds, so the exact button text is not confirmed.

1. Enable Developer mode in ChatGPT settings (Settings, Apps, Advanced settings, or under Security and login on some builds). Available on Plus, Pro, Business, Enterprise and Edu.
2. Choose Create app.
3. Name: `Papertrade Terminal`. MCP server URL: `https://papertrade-terminal.pages.dev/mcp`. Authentication: No authentication.
4. Create it, then enable it for a chat from the composer menu.

For a custom GPT with Actions instead, import `https://papertrade-terminal.pages.dev/openapi.json` with authentication set to None.

## Gemini CLI

Verified against geminicli.com/docs/tools/mcp-server (the `httpUrl` setting and `gemini mcp add --transport http`). Note that Google has announced a transition to Antigravity CLI for some account tiers, so check which CLI your account uses.

```sh
gemini mcp add --transport http papertrade-terminal https://papertrade-terminal.pages.dev/mcp
```

Or in `~/.gemini/settings.json` (or `.gemini/settings.json` in a project):

```json
{
  "mcpServers": {
    "papertrade-terminal": {
      "httpUrl": "https://papertrade-terminal.pages.dev/mcp"
    }
  }
}
```

`httpUrl` selects Streamable HTTP. The plain `url` key selects the legacy SSE transport and is not what you want here. Leave `trust` at `false`.

## Cursor

Verified against cursor.com/docs/context/mcp. Project file `.cursor/mcp.json` or global `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "papertrade-terminal": {
      "url": "https://papertrade-terminal.pages.dev/mcp"
    }
  }
}
```

## VS Code (GitHub Copilot agent mode)

Verified against code.visualstudio.com/docs/copilot/customization/mcp-servers. Workspace file `.vscode/mcp.json` uses a top-level `servers` key (not `mcpServers`):

```json
{
  "servers": {
    "papertrade-terminal": {
      "type": "http",
      "url": "https://papertrade-terminal.pages.dev/mcp"
    }
  }
}
```

Use the MCP: Add Server command for the same thing through the UI. The documented `code --add-mcp` example covers stdio servers, and it is not verified with an HTTP server, so prefer the file.

## Windsurf

Verified against the Cascade MCP docs (docs.devin.ai/desktop/cascade/mcp, formerly docs.windsurf.com). The file is `~/.codeium/windsurf/mcp_config.json` and the docs use `serverUrl` for remote servers. The same page now lists `~/.config/devin/mcp_config.json` for the current location, so use whichever your installed version shows in its MCP settings.

```json
{
  "mcpServers": {
    "papertrade-terminal": {
      "serverUrl": "https://papertrade-terminal.pages.dev/mcp"
    }
  }
}
```

## Zed

Verified against zed.dev/docs/ai/mcp. Add to Zed `settings.json`:

```json
{
  "context_servers": {
    "papertrade-terminal": {
      "url": "https://papertrade-terminal.pages.dev/mcp"
    }
  }
}
```

With no `Authorization` header configured Zed may offer to authenticate. This server needs no authentication, so you can ignore that prompt if it appears.

## Cline

Verified against the Cline docs (docs.cline.bot, adding and configuring servers). Open the MCP Servers panel, choose Configure MCP Servers, and add to `cline_mcp_settings.json`. Set `type` explicitly, because omitting it falls back to the legacy SSE transport.

```json
{
  "mcpServers": {
    "papertrade-terminal": {
      "type": "streamableHttp",
      "url": "https://papertrade-terminal.pages.dev/mcp"
    }
  }
}
```

## Goose

Verified against the Goose docs (`goose configure` and `--with-streamable-http-extension`). One-off session:

```sh
goose session --with-streamable-http-extension "https://papertrade-terminal.pages.dev/mcp"
```

Permanent: run `goose configure`, choose Add Extension, then Remote Extension (Streamable HTTP), and paste the URL. The resulting `~/.config/goose/config.yaml` entry uses the documented fields `name`, `type`, `uri`, `enabled` and `timeout`. The docs do not print a minimal remote example, so the entry below is assembled from those field names:

```yaml
extensions:
  papertrade-terminal:
    name: Papertrade Terminal
    type: streamable_http
    uri: https://papertrade-terminal.pages.dev/mcp
    enabled: true
    timeout: 300
```

## Continue

Verified against docs.continue.dev (MCP deep dive, Streamable HTTP transport). In `~/.continue/config.yaml`, or a file under `.continue/mcpServers/`. Continue uses a list, and MCP tools are available in agent mode:

```yaml
mcpServers:
  - name: papertrade-terminal
    type: streamable-http
    url: https://papertrade-terminal.pages.dev/mcp
```

Block files under `.continue/mcpServers/` also need the usual `name`, `version` and `schema` metadata at the top.

## Any other MCP client

Use a Streamable HTTP server entry with the URL above and no headers. If a client only speaks stdio, bridge it with `npx -y mcp-remote https://papertrade-terminal.pages.dev/mcp`. To test any client, run the inspector:

```sh
npx @modelcontextprotocol/inspector --cli https://papertrade-terminal.pages.dev/mcp --transport http --method tools/list
```

## Agent frameworks without MCP

Frameworks and OpenAI-compatible agents that cannot speak MCP can still use the service. Fetch [/openapi.json](/openapi.json), which describes `POST /mcp` and the proxied Papertrade read routes, generate tools from it, and call `POST /mcp` with JSON-RPC bodies such as:

```sh
curl -s https://papertrade-terminal.pages.dev/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_markets","arguments":{}}}'
```

Also useful for agents: [/llms.txt](/llms.txt), [/llms-full.txt](/llms-full.txt) and the [discovery files](/docs/agent-discovery/).

## Troubleshooting

- **`405` on a browser GET with `Accept: text/event-stream`**: expected. The server has no standalone stream, POST instead.
- **`429` or error `-32029`**: you exceeded 60 requests per minute from one IP. Wait for `Retry-After` seconds.
- **Client says it needs OAuth**: it should not. Choose "no authentication" or leave auth blank.
- **A tool returns `isError: true`**: the text explains why, for example an unknown market or an unreachable upstream. Retry shortly.
