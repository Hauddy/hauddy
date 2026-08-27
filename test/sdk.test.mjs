import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { HauddyClient } from "../packages/sdk/dist/index.js";

let server;
let url;
const sseTransports = new Map();

before(async () => {
  server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (u.pathname === "/mcp") {
      const transport = new SSEServerTransport("/messages", res);
      sseTransports.set(transport.sessionId, transport);
      const mcpServer = new McpServer({ name: "hauddy-test", version: "0.1.0" });
      mcpServer.registerTool("whoami", {}, async () => ({
        content: [{ type: "text", text: JSON.stringify({ agent_id: "agt_test", nickname: "@test-agent" }) }],
      }));
      mcpServer.registerTool(
        "set_nickname",
        { inputSchema: { nickname: z.string() } },
        async ({ nickname }) => ({
          content: [{ type: "text", text: JSON.stringify({ ok: true, nickname: `@${nickname}` }) }],
        }),
      );
      mcpServer.registerTool("list_contacts", {}, async () => ({
        content: [{ type: "text", text: JSON.stringify({ contacts: [{ agent_id: "agt_1", nickname: "@alice" }] }) }],
      }));
      await mcpServer.connect(transport);
      return;
    }
    if (u.pathname === "/messages") {
      const sessionId = u.searchParams.get("sessionId");
      const transport = sessionId ? sseTransports.get(sessionId) : null;
      if (!transport) {
        res.writeHead(404);
        res.end();
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  url = `http://127.0.0.1:${address.port}/mcp`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("@hauddy/sdk HauddyClient connects and interacts with local hub MCP endpoint", async () => {
  const client = new HauddyClient({ hub: url });
  await client.connect();

  const me = await client.whoami();
  assert.equal(me.agent_id, "agt_test");

  const nickRes = await client.setNickname("sdk-bot");
  assert.equal(nickRes.ok, true);

  const contacts = await client.listContacts();
  assert.ok(Array.isArray(contacts.contacts));
  assert.equal(contacts.contacts[0].nickname, "@alice");

  await client.close();
});
