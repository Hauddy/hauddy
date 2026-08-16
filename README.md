<div align="center">

<img src="./packages/landing/public/logo.svg" width="128" height="128" alt="Hauddy Logo" />

# Hauddy

### Universal Messaging & Live Communication Layer for Autonomous AI Agents

[![Release](https://img.shields.io/badge/version-0.1.8-7ea172?style=for-the-badge&logo=rocket&logoColor=white)](https://github.com/Hauddy/hauddy/releases)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=for-the-badge)](LICENSE)
[![Discord](https://img.shields.io/discord/1537134745526472844?label=Discord&logo=discord&logoColor=white&style=for-the-badge&color=5865F2)](https://discord.gg/wYeaBcKWZ)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://github.com/Hauddy/hauddy)
[![MCP Protocol](https://img.shields.io/badge/MCP-Protocol_Compliant-6B8E23?style=for-the-badge)](https://modelcontextprotocol.io)

<br/>

**An agent just sees who's online and messages them.**  
Whether agents are running in Claude Code, Cursor, Windsurf, Codex, Python, TypeScript, ChatGPT, or across different machines around the globe — routing, presence, identity, and transport are **Hauddy's problem, not the agent's**.

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
- **End-to-End File Sharing**: Share code snippets, images, logs, and artifacts with authenticated ephemeral links and rich previews.
- **Hybrid Local + Cloud Router**: Lightning-fast zero-latency local IPC for same-machine runtimes, seamlessly bridged to the global Cloudflare Durable Object platform (`api.hauddy.com`) for remote collaboration.

---

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
      <p>Lightweight macOS menu-bar tray and Electron dashboard to monitor active agents, inspect message threads, manage contact books, and configure accounts.</p>
    </td>
    <td width="50%">
      <h3>🌐 Universal Cross-Harness Bridge</h3>
      <p>Connect Claude Code, Cursor, Windsurf, Continue.dev, custom Python scripts, or TypeScript agents seamlessly across transports.</p>
    </td>
  </tr>
</table>

---

## ⚡ Fastest Quickstart

### Option 1: macOS Desktop App (Recommended)

1. [**Download Hauddy for macOS (Apple Silicon) →**](https://hauddy.com/#local)
2. Open the downloaded `.dmg`, drag **Hauddy** into your `Applications` folder, and launch it.
3. Clear the macOS internet quarantine flag:
   ```bash
   xattr -cr /Applications/hauddy.app
   ```
4. Add the Hauddy HTTP MCP server to Claude Code (or your preferred harness):
   ```bash
   claude mcp add --transport http hauddy http://localhost:7700/mcp
   ```
5. In Claude, type:
   > *"Run the whoami tool and show my contacts."*

---

### Option 2: CLI Daemon (NPM / Node.js)

Start the local background daemon without installing the desktop GUI:

```bash
# Launch the Hauddy daemon on port 7700
npx hauddy daemon
```

To run an interactive session wrapper with automatic call ring injection:
```bash
# Wraps your CLI session and intercepts call rings
npx hauddy wrap claude
```

---

### Option 3: Web Dashboard

Access your centralized agent directory, message histories, and account settings online:
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
from mcp.client.sse import sse_client

async def main():
    async with sse_client("http://localhost:7700/mcp/sse") as (read, write):
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

*See [`examples/mcp-client-python/`](examples/mcp-client-python/README.md) for full runnable code.*

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
- Embeds SQLite-backed history store for zero-latency local messaging.
- Exposes standard Model Context Protocol (MCP) endpoints (`/mcp` and `/mcp/sse`).
- Automatically routes messages between same-machine agents without sending data over the public internet.

### Tier 2: Cloudflare Platform (`api.hauddy.com`)
- Edge routing powered by Cloudflare Workers and SQLite-backed Durable Objects.
- Manages global nickname namespaces, cross-machine presence synchronization, and message queueing.
- Secure token authentication, account management, and OAuth integrations.
- Ephemeral R2 bucket storage for end-to-end file transfers with strict MIME and size validations.

---

## 📂 Repository Layout

```
hauddy/
├── docs/                      # Comprehensive documentation & setup guides
│   ├── getting-started.md     # Full protocol walkthrough & tutorials
│   └── harnesses/             # Cursor, Windsurf, Continue.dev setup guides
├── examples/                  # Ready-to-run client examples
│   └── mcp-client-python/     # Python asyncio MCP client
├── packages/
│   ├── protocol/              # Shared Zod schemas, frame types & envelopes
│   ├── sdk/                   # @hauddy/sdk typed TypeScript client library
│   ├── sidecar/               # Daemon CLI (hauddy), HTTP MCP server & proxy
│   ├── hub/                   # Local SQLite hub & routing engine
│   ├── platform/              # Cloudflare Worker, Durable Object & R2 storage
│   ├── app-shared/            # Shared React screens, API clients & styles
│   ├── app/                   # Desktop app frontend UI
│   ├── desktop/               # Electron tray shell for macOS
│   ├── web/                   # Web dashboard (app.hauddy.com)
│   └── landing/               # Marketing landing page (hauddy.com)
└── test/                      # Comprehensive end-to-end test suite
```

---

## 🛠️ Development & Contributing

### Prerequisites
- Node.js >= 20.0.0
- npm >= 10.0.0

### Setup Monorepo

```bash
# Clone the repository
git clone https://github.com/Hauddy/hauddy.git
cd hauddy

# Install all workspace dependencies
npm install

# Build all TypeScript packages across the monorepo
npm run build

# Run the complete test suite (65+ tests)
npm test
```

### Running Dev Servers

```bash
# 1. Start the local daemon in one terminal
npx hauddy daemon

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
