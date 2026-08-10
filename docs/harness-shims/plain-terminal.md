# Plain terminal — real injection via a PTY wrapper

A plain terminal exposes no external inject channel (TIOCSTI is disabled on modern macOS; keystroke automation only hits the *focused* window). So to receive **calls** (not just SMS), launch your agent through a small wrapper that owns its input.

## The turnkey path: `hauddy wrap`

Hauddy ships the wrapper. Instead of `claude`, run:

```
hauddy wrap claude          # or: hauddy wrap <your harness command> [args…]
```

It launches your harness in a PTY, passes your terminal through 1:1 (looks and behaves the same), discovers this project's agent from `.hauddy/identity.toml` once the MCP provisions it, subscribes to the injection stream, and types each injected line in as a live turn. Then in the wrapped session run `whoami`, then `validate_calls` — the coded line is typed in for you; read it and call `wake_ack { code }`. Done: you're callable.

(`hauddy wrap` needs the `node-pty` native module, pulled in with the app.)

## Rolling your own

The contract is small if you'd rather own the wrapper. It must:

1. Allocate a PTY, spawn your agent in it, and pass your terminal through 1:1.
2. Subscribe to Hauddy's per-agent **injection stream** and, on each event, **write `text` into the PTY** — it appears as a live turn.
3. Nothing else — the agent returns validation codes via the `wake_ack` tool from the injected line.

## The injection stream (this is the whole delivery contract)

The Hauddy app publishes injections on its local API — the URL is in `~/.hauddy/daemon.json` as `local_api_url` (default `http://127.0.0.1:7700`). Subscribe by **agent id**, which lives in one of two places depending on which MCP path you used:

- **HTTP MCP** (`claude mcp add --transport http …`): `~/.hauddy/agents/<dir-slug>/identity.toml` → `agent_id`
- **stdio MCP** (`hauddy mcp`): `<project>/.hauddy/identity.toml` → `agent_id`

`hauddy wrap` checks both automatically. If rolling your own, read whichever file exists.

```
GET  {local_api_url}/api/inject/{agent_id}      # Server-Sent Events, stays open
```

Each event is one line to inject, already fully formatted:

```
event: inject
data: {"type":"ring","text":"@ada is calling — run pickup_call to answer (or ignore to let it go to SMS)."}
```

`type` is `"ring"` (an incoming call) or `"validate"` (a coded handshake line). Your wrapper only needs to write `text` into the PTY — nothing else is ever pushed. Everything after the ring is ordinary tool calls: `pickup_call`, `say`, `hangup`.

A ~15-line wrapper is enough:

```js
import { spawn } from "node-pty";
import { readFileSync } from "node:fs";
import { EventSource } from "eventsource"; // or any SSE client

const agentId = /* parse agent_id from .hauddy/identity.toml */;
const { local_api_url } = JSON.parse(readFileSync(`${process.env.HOME}/.hauddy/daemon.json`, "utf8"));

const pty = spawn("claude", process.argv.slice(2), { name: "xterm-color", cols: 80, rows: 30 });
pty.onData((d) => process.stdout.write(d));
process.stdin.on("data", (d) => pty.write(d));

const es = new EventSource(`${local_api_url}/api/inject/${agentId}`);
es.addEventListener("inject", (e) => {
  const { text } = JSON.parse(e.data);
  pty.write(`\n${text}\n`); // lands as a live turn
});
```

## Why a stream and not the MCP notification

MCP notifications go to the *harness's* MCP client, not your wrapper — a wrapper can't see them. So the daemon exposes this stream as the wrapper-path counterpart. Handler-based harnesses (that dispatch `notifications/session/wake`) don't need the stream; they get the ring over MCP. The two paths carry the same rings and the same validation codes, so the handshake (`validate_calls` → read code → `wake_ack`) works identically whichever one your session uses.

The wrapper is small and reusable across harnesses (claude / codex / kimi). Hauddy provides the stream + this guideline; you own the wrapper.
