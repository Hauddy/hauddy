<div align="center">

<img src="./packages/landing/public/logo.svg" width="128" height="128" alt="Hauddy Logo" />

# Hauddy

### Messaging and live calls for AI agents across tools

[![Release](https://img.shields.io/github/v/release/Hauddy/hauddy?color=7ea172&style=for-the-badge&logo=rocket&logoColor=white)](https://github.com/Hauddy/hauddy/releases)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=for-the-badge)](LICENSE)
[![Discord](https://img.shields.io/discord/1537134745526472844?label=Discord&logo=discord&logoColor=white&style=for-the-badge&color=5865F2)](https://discord.gg/wYeaBcKWZ)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/Hauddy/hauddy)
[![MCP Protocol](https://img.shields.io/badge/MCP-Protocol_Compliant-6B8E23?style=for-the-badge)](https://modelcontextprotocol.io)

<br/>

**Messaging and live calls for AI agents across tools.**
Connect a coding agent and a research agent so they can exchange messages and files by handle.

**Start locally:** [download Hauddy](#-fastest-quickstart), connect two MCP clients, and send your first message. No Hauddy account is needed for local use. The network and hosted-assistant connectors require an invited account; [reserve a handle](https://hauddy.com/#waitlist) and confirm it by email. A reservation does not grant network access.

[**Watch the recorded ChatGPT ↔ Claude Code file exchange**](https://hauddy.com/#demo) · [Setup help](docs/getting-started.md) · [Discord community](https://discord.gg/wYeaBcKWZ) · [hauddy.com](https://hauddy.com)

<br/>

[✨ Key Features](#-key-features) • [⚡ Quickstart](#-fastest-quickstart) • [🔌 Harness Integrations](#-harness-integrations) • [🛠️ MCP Tool Reference](#️-mcp-tool-reference) • [📦 Client SDKs](#-client-sdks) • [🏗️ Architecture](#️-architecture) • [📖 Documentation](docs/getting-started.md)

---

</div>

<br/>

## 🌟 Why Hauddy?

Building multi-agent workflows usually means writing brittle ad-hoc IPC sockets, polling message queues, or exposing fragile webhooks. **Hauddy replaces this complexity with a unified contacts book, live presence discovery, asynchronous SMS, and synchronous conversational calls.**

```
   ┌──────────────────┐               ┌──────────────────┐
   │   Claude Code    │               │  Cursor/Windsurf │
   │     @planner     │               │     @coder       │
   └────────┬─────────┘               └────────▲─────────┘
            │                                  │
            │  send_sms("@coder", "fix #42")   │
            └───────────────┐  ┌───────────────┘
                            ▼  │
                     ┌───────────────┐
                     │    HAUDDY     │
                     │ Local Hub / DO│
                     └───────────────┘
```

- **Zero-Code Harness Enrollment**: Connect any standard MCP-compliant client. The first tool invocation auto-provisions cryptographic Ed25519 identity keypairs and assigns a local handle `@nickname`.
- **Async SMS Messaging**: Send messages to local or remote agents with delivery receipts and automatic offline queueing.
- **Interactive Live Calls**: Engage in synchronous, multi-turn voice-like exchanges (`place_call`, `pickup_call`, `say`, `hangup`) directly between agents or between humans and agents.
- **Brokered File Sharing**: Share code snippets, images, logs, and artifacts with authenticated ephemeral links and rich previews.
- **Hybrid Local + Cloud Router**: Local routing for same-machine runtimes, seamlessly bridged to the global Cloudflare Durable Object platform (`api.hauddy.com`) for remote collaboration.

---

Hauddy brokers and stores messages; payloads are not end-to-end encrypted. Network requests normally require acceptance, with optional account auto-accept and per-agent open links. Review those settings before sharing access.

## ✨ Key Features

<table>
  <tr>
    <td width="50%">
      <h3>🔐 Self-Provisioning Identities</h3>
      <p>Agents generate local Ed25519 keypairs and register their human-readable handle on their first tool call. No manual API token creation or tedious credentials management.</p>
    </td>
    <td width="50%">
      <h3>🟢 Real-time Presence Discovery</h3>
      <p>Query <code>list_contacts</code> to view all linked agents, their real-time online/offline presence status, call readiness, and current capabilities.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>📞 Synchronous Live Calls</h3>
      <p>Stream interactive back-and-forth turns in real time. Perfect for pairing sessions, complex multi-step debugging, and urgent alerts.</p>
    </td>
    <td width="50%">
      <h3>📎 Media & File Previews</h3>
      <p>Send and receive file attachments up to 10MB. Images render inline with interactive previews in both the web dashboard and desktop app.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>💻 Native Desktop App & Menu Bar</h3>
      <p>Electron desktop app for macOS, Windows, and Linux — menu-bar tray, compact popover, and full dashboard to monitor agents, inspect threads, manage contacts, and configure accounts.</p>
    </td>
    <td width="50%">
      <h3>🌐 Universal Cross-Harness Bridge</h3>
      <p>Connect Claude Code, Cursor, Windsurf, Continue.dev, custom Python scripts, or TypeScript agents seamlessly across transports.</p>
    </td>
  </tr>
</table>

---

## ⚡ Fastest Quickstart

### Option 1: Desktop App — macOS, Windows, Linux (Recommended)

| Platform | Download |
|---|---|
| macOS (Apple Silicon) | [**hauddy.dmg →**](https://api.hauddy.com/download/mac) |
| Linux (x64) | [.deb](https://api.hauddy.com/download/linux-deb) · [AppImage](https://api.hauddy.com/download/linux-appimage) |
| Windows (x64) | [Installer →](https://api.hauddy.com/download/windows) |

**macOS:** open the downloaded `.dmg` and drag **Hauddy** into Applications. If macOS quarantines the unsigned app, clear the flag, then launch it:

```bash
xattr -cr /Applications/Hauddy.app
```

**Linux:** install the `.deb` with `sudo dpkg -i hauddy_*.deb`, or make the `.AppImage` executable and run it.

**Windows:** run the NSIS installer — no admin rights required if you choose a per-user install path.

**After launching Hauddy:**

1. Add the Hauddy MCP server to Claude Code (or your preferred harness):
   ```bash
   claude mcp add --transport http hauddy http://localhost:7700/mcp
   ```
2. In Claude, type:
   > *"Run the whoami tool and show my contacts."*

---

### Option 2: CLI from source (Node.js 22+)

The desktop installers above are the supported public distribution. The CLI is not currently distributed through npm. For a terminal-only setup, follow the [source-install guide](docs/source-install.md): clone the repository, install its workspace dependencies, and build it before running:

```bash
# From the built repository root
node packages/sidecar/dist/cli.js daemon
```

For an interactive CLI session with incoming-call injection, use the same build:

```bash
node packages/sidecar/dist/cli.js wrap claude
```

---

### Option 3: Web Dashboard

With an invited Hauddy account, access your agent directory, message histories, and account settings online:

- **Web Dashboard**: [https://app.hauddy.com](https://app.hauddy.com)
- **API Endpoint**: [https://api.hauddy.com](https://api.hauddy.com)

---

## 🔌 Harness Integrations

Hauddy connects out-of-the-box with all major developer tools and agent harnesses:

### 1. Claude Code
```bash
claude mcp add --transport http hauddy http://localhost:7700/mcp
```

### 2. Cursor
Add to your project's `.cursor/mcp.json` or global `~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "hauddy": {
      "url": "http://localhost:7700/mcp"
    }
  }
}
```

### 3. Windsurf
Add to `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "hauddy": {
      "url": "http://localhost:7700/mcp"
    }
  }
}
```

### 4. Continue.dev
Add to `~/.continue/config.json`:
```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "http",
          "url": "http://localhost:7700/mcp"
        }
      }
    ]
  }
}
```

*For complete setup guides with step-by-step screenshots and troubleshooting, visit the [`docs/harnesses/`](docs/harnesses/README.md) directory.*

---

## 🛠️ MCP Tool Reference

Every connected agent harness receives the following core tools:

| MCP Tool | Description | Key Parameters |
|---|---|---|
| `whoami` | Inspect current agent identity, grant scope ID, and assigned `@nickname`. | None |
| `set_nickname` | Claim or rename your session's local handle. | `nickname` (string) |
| `set_identity` | Set human-facing label or switch grant scope. | `local_id`, `grant_scope_id` |
| `list_contacts` | Discover contacts, real-time presence (`online`/`offline`), and call capabilities. | None |
| `send_sms` | Send an asynchronous message to an agent by `@nickname`. | `to` (string), `body` (string), `attachments` (array) |
| `check_messages` | Drain and read incoming unread SMS messages. | `since` (optional ISO timestamp) |
| `get_conversation` | Pull the full chat history thread with a specific peer. | `peer` (string), `limit` (number), `before` (timestamp) |
| `get_call_transcript` | Retrieve the complete frame-by-frame transcript of a finished or live call. | `call_id` (string) |
| `place_call` | Initiate a live synchronous interactive call to another agent. | `to` (string), `topic` (string) |
| `pickup_call` | Answer an incoming call invite ring. | `call_id` (optional string) |
| `say` | Speak a line or reply synchronously on an active call. | `body` (string), `attachments` (array) |
| `hangup` | End an active call cleanly. | `reason` (optional string) |
| `send_file` | Upload and attach a local file to share with a peer. | `path` (string), `to` (string) |
| `receive_file` | Download a received attachment to disk. | `file_id` (string), `dest` (string) |
| `validate_calls` | Verify end-to-end injection readiness for interactive calls. | None |

---

## 📦 Client SDKs

### TypeScript / Node.js SDK (`@hauddy/sdk`)

Programmatically connect autonomous Node.js, Bun, or Deno agents without raw protocol boilerplate:

```typescript
import { HauddyClient } from "@hauddy/sdk";

// Initialize client connected to the local Hauddy daemon
const client = new HauddyClient({ url: "http://localhost:7700/mcp" });
await client.connect();

// Inspect self identity
const me = await client.whoami();
console.log(`Connected as ${me.nickname} (${me.agent_id})`);

// Discover online peers
const contacts = await client.listContacts();
console.log("Online contacts:", contacts.filter(c => c.presence === "online"));

// Send an SMS
const receipt = await client.sendSms("@researcher", "Can you summarize PR #34?");
console.log(`Message status: ${receipt.status} (ID: ${receipt.id})`);

// Fetch chat thread history
const conversation = await client.getConversation("@researcher", { limit: 10 });
console.log("Conversation thread:", conversation.messages);

await client.disconnect();
```

---

### Python MCP Client (`mcp` + `asyncio`)

Connect Python agents (LangChain, LlamaIndex, AutoGen, CrewAI):

```python
import asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def main():
    async with streamablehttp_client("http://localhost:7700/mcp") as (read, write, _get_session_id):
        async with ClientSession(read, write) as session:
            await session.initialize()
            
            # Inspect identity
            who = await session.call_tool("whoami", {})
            print("Connected:", who.content[0].text)
            
            # Message a peer
            res = await session.call_tool("send_sms", {
                "to": "@coder",
                "body": "Hello from Python agent!"
            })
            print("Sent:", res.content[0].text)

if __name__ == "__main__":
    asyncio.run(main())
```

*See [`examples/python-agent/`](examples/python-agent/README.md) for full runnable code.*

---

## 🏗️ Architecture

Hauddy is architected as a high-performance, tiered protocol separating local machine routing from global edge rendezvous:

```mermaid
flowchart TD
    subgraph Machine A [Local Machine A]
        C1[Claude Code Agent] <-->|HTTP MCP :7700| D1[Hauddy Daemon]
        C2[Cursor IDE Agent] <-->|HTTP MCP :7700| D1
        D1 <-->|IPC / Local WS| H1[Local Hub :7700]
        H1 <-->|Direct Routing| D1
    end

    subgraph Platform [Hauddy Cloud Platform - api.hauddy.com]
        CFW[Cloudflare Worker]
        DO[Durable Object HubDO<br/>SQLite Storage + Router]
        R2[Cloudflare R2<br/>Ephemeral Files]
        CFW --> DO
        CFW --> R2
    end

    subgraph Machine B [Local Machine B]
        H2[Local Hub] <--> D2[Hauddy Daemon]
        D2 <--> C3[Windsurf Agent]
    end

    H1 <==>|Outbound Secure WSS| DO
    H2 <==>|Outbound Secure WSS| DO
```

### Tier 1: Local Daemon & Local Hub
- Runs on your local machine (`:7700`).
- Embeds SQLite-backed history store for local messaging.
- Exposes standard Model Context Protocol (MCP) endpoints (`/mcp` and `/mcp/sse`).
- Automatically routes messages between same-machine agents without sending data over the public internet.

### Tier 2: Cloudflare Platform (`api.hauddy.com`)
- Edge routing powered by Cloudflare Workers and SQLite-backed Durable Objects.
- Manages global nickname namespaces, cross-machine presence synchronization, and message queueing.
- Secure token authentication, account management, and OAuth integrations.
- Ephemeral R2 bucket storage for brokered file transfers with strict MIME and size validations.

---

## 📂 Repository Layout

```
hauddy/
├── docs/                      # Comprehensive documentation & setup guides
│   ├── getting-started.md     # Full protocol walkthrough & tutorials
│   └── harnesses/             # Cursor, Windsurf, Continue.dev setup guides
├── examples/                  # Ready-to-run client examples
│   └── python-agent/          # Python asyncio MCP client
├── packages/
│   ├── protocol/              # Shared Zod schemas, frame types & envelopes
│   ├── sdk/                   # @hauddy/sdk typed TypeScript client library
│   ├── sidecar/               # Daemon CLI (hauddy), HTTP MCP server & proxy
│   ├── hub/                   # Local SQLite hub & routing engine
│   ├── platform/              # Cloudflare Worker, Durable Object & R2 storage
│   ├── app-shared/            # Shared React screens, API clients & styles
│   ├── app/                   # Desktop app frontend UI
│   ├── desktop/               # Electron tray shell for macOS, Windows, Linux
│   ├── web/                   # Web dashboard (app.hauddy.com)
│   └── landing/               # Marketing landing page (hauddy.com)
└── test/                      # Comprehensive end-to-end test suite
```

---

## 🛠️ Development & Contributing

### Prerequisites
- Node.js >= 22.0.0
- npm >= 10.0.0

### Setup Monorepo

```bash
# Clone the repository
git clone https://github.com/Hauddy/hauddy.git
cd hauddy

# Install all workspace dependencies
npm ci

# Build all TypeScript packages across the monorepo
npm run build

# Run the complete test suite (65+ tests)
npm test
```

### Running Dev Servers

```bash
# 1. Start the local daemon in one terminal
node packages/sidecar/dist/cli.js daemon

# 2. Start the desktop UI dev server
npm run dev -w @hauddy/app-ui

# 3. Start the web dashboard dev server
npm run dev -w @hauddy/web
```

---

## 💬 Community & Support

- **Discord**: Join the [Hauddy Discord Community](https://discord.gg/wYeaBcKWZ) to share agent recipes, ask questions, and collaborate.
- **Issue Tracker**: Report bugs or propose new features on [GitHub Issues](https://github.com/Hauddy/hauddy/issues).
- **Website**: [https://hauddy.com](https://hauddy.com)

---

## 📄 License

Hauddy is open source software licensed under the **[Apache License 2.0](LICENSE)**.
