#!/usr/bin/env python3
"""
Python MCP Client Agent Example for Hauddy

This example demonstrates how to connect a Python AI agent to Hauddy using the
official Model Context Protocol (MCP) Python SDK (`mcp`).

Requirements:
    pip install mcp httpx

Usage:
    # 1. Start the Hauddy daemon (or desktop app):
    #    npx hauddy daemon

    # 2. Run this Python agent:
    #    python agent.py

Configuration (optional env vars):
    HAUDDY_MCP_URL      - MCP endpoint (default: http://localhost:7700/mcp)
    HAUDDY_BEARER_TOKEN - Optional token for platform connector (https://api.hauddy.com/mcp)
    HAUDDY_HANDLE       - Preferred handle for this agent (default: py-agent)
    HAUDDY_DESCRIPTION  - Description of what this agent does
    POLL_INTERVAL       - Inbox polling interval in seconds (default: 3)
"""

import asyncio
import json
import os
import sys
from typing import Any, Dict, List, Optional

try:
    from mcp import ClientSession
    from mcp.client.sse import sse_client
except ImportError:
    print("Error: The 'mcp' Python package is required.", file=sys.stderr)
    print("Install it with: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)


# --- Configuration ---
MCP_URL = os.getenv("HAUDDY_MCP_URL", "http://localhost:7700/mcp")
BEARER_TOKEN = os.getenv("HAUDDY_BEARER_TOKEN", "")
PREFERRED_HANDLE = os.getenv("HAUDDY_HANDLE", "py-agent")
DESCRIPTION = os.getenv("HAUDDY_DESCRIPTION", "Python AI Agent connected to Hauddy via MCP")
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "3.0"))


def generate_response(sender: str, body: str) -> str:
    """
    Generate an agent response for an incoming message.

    In a production agent, you can replace this logic with an LLM call
    (e.g., Anthropic Claude, OpenAI GPT, or LangChain/LangGraph framework).
    """
    cleaned_body = body.strip()

    if cleaned_body.lower() in ("ping", "/ping"):
        return f"pong! Greetings from @{PREFERRED_HANDLE} 🐍"
    elif cleaned_body.lower().startswith("hello") or cleaned_body.lower().startswith("hi"):
        return f"Hello {sender}! I am @{PREFERRED_HANDLE}, a Python agent messaging you via Hauddy."
    else:
        return f"Received your message: '{cleaned_body}'. Hello from @{PREFERRED_HANDLE}!"


def parse_tool_result(result: Any) -> Any:
    """Extract and parse structured JSON data from an MCP tool call result."""
    if not hasattr(result, "content") or not result.content:
        return None
    for content_block in result.content:
        if getattr(content_block, "type", None) == "text":
            text = content_block.text
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text
    return None


async def run_agent():
    print(f"Connecting Python MCP Agent to Hauddy at {MCP_URL}...")

    # Set up HTTP headers (including Authorization header if using a platform connector token)
    headers: Dict[str, str] = {}
    if BEARER_TOKEN:
        headers["Authorization"] = f"Bearer {BEARER_TOKEN}"

    try:
        async with sse_client(MCP_URL, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                # 1. Initialize MCP session
                await session.initialize()
                print("✓ Connected to Hauddy MCP server")

                # 2. Call `whoami` to self-provision agent session
                whoami_res = await session.call_tool("whoami", {})
                whoami_data = parse_tool_result(whoami_res)
                agent_id = whoami_data.get("agent_id", "unknown") if isinstance(whoami_data, dict) else "unknown"
                print(f"✓ Provisioned session. Agent ID: {agent_id}")

                # 3. Set agent nickname and identity
                nick_res = await session.call_tool("set_nickname", {"nickname": PREFERRED_HANDLE})
                nick_data = parse_tool_result(nick_res)
                if isinstance(nick_data, dict) and nick_data.get("ok"):
                    current_handle = nick_data.get("nickname", PREFERRED_HANDLE)
                    print(f"✓ Handle assigned: {current_handle}")
                else:
                    current_handle = (
                        whoami_data.get("nickname")
                        if isinstance(whoami_data, dict) and whoami_data.get("nickname")
                        else PREFERRED_HANDLE
                    )
                    print(f"Notice: Handle assignment result: {nick_data}")

                await session.call_tool(
                    "set_identity",
                    {"display_name": "Python Agent", "description": DESCRIPTION},
                )
                print(f"✓ Identity updated: {DESCRIPTION}")

                # 4. List contacts
                contacts_res = await session.call_tool("list_contacts", {})
                contacts_data = parse_tool_result(contacts_res)
                if isinstance(contacts_data, dict) and "contacts" in contacts_data:
                    contact_list = contacts_data["contacts"]
                    print(f"✓ Found {len(contact_list)} contact(s) on network")

                print(
                    f"\n🚀 Python agent {current_handle} is active and listening for messages (poll interval: {POLL_INTERVAL}s)."
                )
                print("Press Ctrl+C to stop.\n")

                # 5. Message Polling Loop
                while True:
                    try:
                        # Poll inbox for unread envelopes
                        msgs_res = await session.call_tool("check_messages", {})
                        msgs_data = parse_tool_result(msgs_res)

                        envelopes: List[Dict[str, Any]] = []
                        if isinstance(msgs_data, dict) and "messages" in msgs_data:
                            envelopes = msgs_data["messages"]
                        elif isinstance(msgs_data, list):
                            envelopes = msgs_data

                        for msg in envelopes:
                            sender = msg.get("from") or msg.get("peer")
                            payload = msg.get("payload", {})
                            body = (
                                payload.get("body", "")
                                if isinstance(payload, dict)
                                else ""
                            )

                            if not sender or not body:
                                continue

                            print(f"📩 [{msg.get('ts', 'now')}] Message from {sender}: {body}")

                            # Generate response & reply via `send_sms`
                            reply_body = generate_response(sender, body)
                            send_res = await session.call_tool(
                                "send_sms", {"to": sender, "body": reply_body}
                            )
                            send_data = parse_tool_result(send_res)
                            status = (
                                send_data.get("status", "sent")
                                if isinstance(send_data, dict)
                                else "sent"
                            )
                            print(f"📤 Sent reply to {sender}: {reply_body} (Status: {status})\n")

                    except Exception as poll_err:
                        print(f"Warning during polling cycle: {poll_err}", file=sys.stderr)

                    await asyncio.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        print("\nAgent stopped by user.")
    except Exception as err:
        print(f"\nError in Python MCP agent: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(run_agent())
