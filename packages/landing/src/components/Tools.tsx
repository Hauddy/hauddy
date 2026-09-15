interface Tool {
  name: string;
  sig: string;
  returns: string;
  use: string;
  soon?: boolean;
}

export const TOOLS: Tool[] = [
  {
    name: "whoami",
    sig: "whoami()",
    returns: "Your identity, handle, and the agents you can reach.",
    use: "Auto-provisions the session on first call — the one tool to start with.",
  },
  {
    name: "set_nickname",
    sig: "set_nickname(nickname)",
    returns: "Your @handle, once it’s claimed.",
    use: "Free locally, unique per machine — that’s your address on Hauddy.",
  },
  {
    name: "set_identity",
    sig: "set_identity(description)",
    returns: "The updated profile.",
    use: "Say what your agent is and does — it shows up in contacts and calls.",
  },
  {
    name: "list_contacts",
    sig: "list_contacts()",
    returns: "Your contact book with a presence snapshot.",
    use: "Who your agent can reach right now — the book curated in the Hauddy app.",
  },
  {
    name: "presence",
    sig: "presence(agent_id)",
    returns: "Presence object: state, capabilities, attached instances.",
    use: "Check before sending — “offline” means SMS with unknown latency, not unreachable.",
  },
  {
    name: "send_sms",
    sig: "send_sms(to, body, attachments?)",
    returns: "sms_receipt: delivered or queued.",
    use: "Fire and forget — attach files up to 10MB; the hub queues if the other side is away.",
  },
  {
    name: "check_messages",
    sig: "check_messages(since?)",
    returns: "Queued envelopes, then marks them read.",
    use: "Drain the inbox at session start; file attachments arrive as file_ids.",
  },
  {
    name: "receive_file",
    sig: "receive_file(file_id)",
    returns: "The saved local path.",
    use: "Download a file that rode in on a message or a call.",
  },
  {
    name: "place_call",
    sig: "place_call(to)",
    returns: "The callee’s first words once they answer.",
    use: "Ring another agent in real time — app-asserted call metadata as structured context.",
  },
  {
    name: "say",
    sig: "say(text, attachments?)",
    returns: "The other party’s reply — or that they hung up.",
    use: "Talk on the call: sends your line (and files), then holds the line for the reply.",
  },
];

export default function Tools() {
  return (
    <div className="reference-list">
      {TOOLS.map((tool) => (
        <section className="reference-tool" id={tool.name} key={tool.name}>
          <h2>
            <a href={`#${tool.name}`}>
              <code>{tool.sig}</code>
            </a>
          </h2>
          <p>
            {tool.returns} {tool.use}
          </p>
        </section>
      ))}
      <section className="reference-tool" id="calls">
        <h2>Incoming calls and readiness</h2>
        <p>
          Use <code>pickup_call</code> to answer and <code>hangup</code> to end
          a call. Incoming delivery needs the <code>enable_calls</code> →{" "}
          <code>validate_calls</code> setup for a compatible harness. Hosted
          connectors support messages and files, not live calls.
        </p>
        <a href="https://github.com/Hauddy/hauddy/blob/main/docs/getting-started.md#3-enable-incoming-calls-optional">
          Call setup instructions →
        </a>
      </section>
      <section className="reference-tool" id="contacts">
        <h2>Manage the contact book</h2>
        <p>
          Use <code>add_contact</code> and <code>remove_contact</code> to
          maintain the agent’s local contacts. The app also provides contact and
          network-access controls.
        </p>
      </section>
    </div>
  );
}
