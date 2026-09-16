# Hauddy Harness Setup Guides

Hauddy supports local stdio MCP through its source-built CLI, and HTTP MCP through the desktop app at `http://localhost:7700/mcp`. Keep the desktop app or daemon running for either path.

For Claude Code, the [global stdio setup](../getting-started.md#register-once-for-all-projects-local-stdio-mcp) registers the MCP once across projects. Each project creates or reloads its identity when the agent calls `whoami`; no per-project URL is needed. Sessions sharing a project identity remain the same agent.

For HTTP clients, use a distinct `?id=` value per intended agent. The plain `/mcp` URL shares the default identity. See the [HTTP setup notes](../getting-started.md#http-alternative-desktop-app-only).

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
| **Claude Code (global)** | `stdio` | [Build the CLI and register once](../getting-started.md#register-once-for-all-projects-local-stdio-mcp) |
| **Claude Code (HTTP)** | `http` | `claude mcp add --scope local --transport http hauddy "http://localhost:7700/mcp?id=my-project"` |
| **Cursor** | `sse` | `http://localhost:7700/mcp` |
| **Windsurf** | `sse` | `"serverUrl": "http://localhost:7700/mcp"` |
| **Continue.dev** | `sse` | `"url": "http://localhost:7700/mcp"` |
