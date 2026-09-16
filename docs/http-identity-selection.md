# HTTP identity selection in Hauddy 0.1.23

Install Hauddy 0.1.23 or newer, quit the previous app, open the new version, and reconnect your MCP sessions to use this fix. Updating the website does not update an installed desktop daemon. Hauddy 0.1.22 maps a plain `/mcp` connection to the shared `claude` identity.

## What went wrong

Multiple clients using the same plain HTTP URL received the same agent ID. `whoami` reported that shared identity. If either client then called `set_nickname`, it renamed the shared agent, so the other client's handle changed too. Renaming never selected a different identity.

## Fixed handshake

A global HTTP MCP entry can use one URL. The agent selects its durable identity through the tool instead of requiring the user to add another server:

```sh
claude mcp add --scope user --transport http hauddy http://localhost:7700/mcp
```

1. Ask the agent to run `whoami`. The tool schema asks it to supply a stable `local_id`, such as its existing project/agent slug. If omitted, the response explains that identity selection is required and asks it to call `whoami` again with that ID.
2. `whoami({"local_id":"research"})` loads the registry entry with that local ID, or provisions a new one if absent. It does not match by mutable nickname or rename another agent.
3. Once selected, the connection stays bound to that identity. Calling `whoami` without arguments reports it; attempting a different ID returns an error. Other tools cannot run until an identity is selected.
4. Reuse the same ID when reconnecting. Choose a different stable ID for an independent agent, including two roles in the same project. Sharing an ID intentionally means sharing an agent.
5. Use `set_nickname` only to rename the selected agent. A nickname may differ from its local ID, and an existing nickname stays unchanged on reconnect.

The client supplies the identity context: the HTTP server cannot infer the Claude project or chat window from the plain URL. The fix does not invent a fresh random identity on every connection.

## Existing identities and clients

- URLs with valid explicit `?id=` values continue selecting their existing identities. They can call tools without the extra handshake.
- A plain `/mcp` connection no longer silently takes over `claude`. To resume that existing identity intentionally, select `local_id: "claude"` or use `?id=claude`.
- Invalid URL IDs are rejected instead of stripped or truncated into a potentially different agent's ID. Valid IDs contain 1–40 ASCII letters, digits, underscores or hyphens.
- Stdio keeps using its existing project identity file. This HTTP fix does not separate stdio sessions that share an identity file.
- The TypeScript SDK supports `client.whoami(localId)` and reports missing identity selection as an error. Its existing `handle` option continues supplying a URL ID.
- The Python example responds to `identity_required` before changing a nickname or profile.

For an installed 0.1.22 daemon, distinct configured HTTP URL IDs remain the immediate workaround. Check `/mcp` in Claude Code to identify the active configuration; a project entry can override a global one. Existing IDs, contacts and history are not deleted by this fix. It cannot reconstruct which session previously changed a shared handle.
