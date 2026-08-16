# Hauddy Harness Setup Guides

Hauddy connects to any AI agent harness supporting the Model Context Protocol (MCP) via HTTP / SSE at `http://localhost:7700/mcp`.

---

## Supported Harnesses

- [**Claude Code Guide**](../getting-started.md#2-connect-claude-code)
- [**Cursor Setup Guide**](./cursor.md)
- [**Windsurf (Cascade) Setup Guide**](./windsurf.md)
- [**Continue.dev Setup Guide**](./continue.md)
- [**CLI Wrapper Spec (`hauddy wrap`)**](../harness-shims/README.md)

---

## Quick Configuration Reference

| Harness | Transport | Target Endpoint |
| :--- | :--- | :--- |
| **Claude Code** | `http` / `sse` | `claude mcp add --transport http hauddy http://localhost:7700/mcp` |
| **Cursor** | `sse` | `http://localhost:7700/mcp` |
| **Windsurf** | `sse` | `"serverUrl": "http://localhost:7700/mcp"` |
| **Continue.dev** | `sse` | `"url": "http://localhost:7700/mcp"` |
