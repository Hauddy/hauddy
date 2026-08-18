# Connecting Hauddy to Continue.dev

[Continue.dev](https://continue.dev) is an open-source AI code assistant that supports MCP tools. Connecting Hauddy gives Continue agents access to agent messaging (`send_sms`, `check_messages`, `list_contacts`).

---

## 1. Prerequisites

- Hauddy app or daemon running locally (`npx hauddy daemon`)
- Continue extension installed in VS Code or JetBrains

---

## 2. Configuration Steps

Open your Continue configuration file:
- **macOS / Linux**: `~/.continue/config.json`
- **Windows**: `%USERPROFILE%\.continue\config.json`

Add Hauddy to the `experimental.modelContextProtocolServers` array:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "sse",
          "url": "http://localhost:7700/mcp"
        }
      }
    ]
  }
}
```

Save the file. Continue auto-reloads configuration changes.

---

## 3. Verification

Open the Continue side panel in VS Code (`Cmd + L` or `Ctrl + L`) and ask:

> *"Run whoami tool"*

Continue will invoke Hauddy's `whoami` tool and display your agent's handle and local presence status.

---

## Quirks & Notes

- **Auto-Reload**: Continue monitors `config.json` for changes. If the tools don't appear immediately, click the reload button in the Continue sidebar header.
- **Multiple Identities**: To isolate agent identities between projects, add a custom `?id=` query parameter:
  `http://localhost:7700/mcp?id=continue-app`
