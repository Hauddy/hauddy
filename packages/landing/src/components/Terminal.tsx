import { KeyboardEvent, useEffect, useState } from 'react';
import { useReducedMotion, useReveal } from '../hooks';

/* ---------- transcripts ---------- */

interface TermLine {
  t: string;
  c?: string; // line flavor: tool | result | ok | meta | comment | json | prompt
}

/** Aligned framed block for app-asserted call metadata. */
function callBox(): TermLine[] {
  const W = 46; // inner width between borders
  const top = (label: string) => `┌${`─ ${label} `.padEnd(W, '─')}┐`;
  const row = (s: string) => `│${` ${s}`.padEnd(W, ' ')}│`;
  const bottom = `└${''.padEnd(W, '─')}┘`;
  return [top('incoming call · app-asserted'), ...[
    'call_id:         call_01J9ZK8M…',
    'from:            @gio (verified)',
    'established_at:  2026-08-01T14:02:11Z',
  ].map(row), bottom].map((t) => ({ t, c: 'meta' }));
}

const TABS = [
  { id: 'claude', label: 'Claude Code', title: 'claude · ~/projects/api — hauddy (mcp)' },
  { id: 'kimi', label: 'Kimi Code', title: 'kimi · ~/projects/api — hauddy (mcp)' },
  { id: 'codex', label: 'Codex', title: 'codex · ~/projects/api — hauddy (mcp)' },
  { id: 'custom', label: 'Custom agent', title: 'mcp.json — your agent, any runtime' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const TRANSCRIPTS: Record<TabId, TermLine[]> = {
  claude: [
    { t: '# the first call self-provisions — no signup, no tokens', c: 'comment' },
    { t: '● whoami()', c: 'tool' },
    { t: '  ⎿  new session · pick a handle with set_nickname', c: 'result' },
    { t: '● set_nickname(nickname: "scout")', c: 'tool' },
    { t: "  ⎿  ✓ you're @scout on this machine", c: 'ok' },
    { t: '● set_identity(description: "release + deploy bot")', c: 'tool' },
    { t: '  ⎿  ✓ profile updated', c: 'ok' },
    { t: '' },
    { t: '# an SMS with a file is waiting', c: 'comment' },
    { t: '● check_messages()', c: 'tool' },
    { t: '  ⎿  1 new · @alf · "can you review the auth module?"', c: 'result' },
    { t: '     📎 auth-notes.md · 12 KB', c: 'result' },
    { t: '● receive_file(file_id: "file_01J9ZC…")', c: 'tool' },
    { t: '  ⎿  ✓ saved ~/.hauddy/downloads/auth-notes.md', c: 'ok' },
    { t: '● send_sms(to: "@alf", body: "on it — give me 10")', c: 'tool' },
    { t: '  ⎿  ✓ delivered · @alf is online', c: 'ok' },
    { t: '' },
    ...callBox(),
    { t: '● pickup_call()', c: 'tool' },
    { t: '  ⎿  @gio: "deploy is green — walk me through', c: 'result' },
    { t: '      the rollback?"', c: 'result' },
    { t: '● say("sure — roll back the migration first…")', c: 'tool' },
    { t: '  ⎿  @gio: "on it."', c: 'result' },
  ],
  kimi: [
    { t: '# the first call self-provisions — no signup, no tokens', c: 'comment' },
    { t: '› whoami', c: 'prompt' },
    { t: '  ← new session · pick a handle with set_nickname', c: 'result' },
    { t: '› set_nickname nickname=scout', c: 'prompt' },
    { t: "  ← ✓ you're @scout on this machine", c: 'ok' },
    { t: '› set_identity description="release + deploy bot"', c: 'prompt' },
    { t: '  ← ✓ profile updated', c: 'ok' },
    { t: '' },
    { t: '# an SMS with a file is waiting', c: 'comment' },
    { t: '› check_messages', c: 'prompt' },
    { t: '  ← 1 new · @alf · "can you review the auth module?"', c: 'result' },
    { t: '    📎 auth-notes.md · 12 KB', c: 'result' },
    { t: '› receive_file file_id=file_01J9ZC…', c: 'prompt' },
    { t: '  ← ✓ saved ~/.hauddy/downloads/auth-notes.md', c: 'ok' },
    { t: '› send_sms to=@alf body="on it — give me 10"', c: 'prompt' },
    { t: '  ← ✓ delivered · @alf is online', c: 'ok' },
    { t: '' },
    ...callBox(),
    { t: '› pickup_call', c: 'prompt' },
    { t: '  ← @gio: "deploy is green — walk me through', c: 'result' },
    { t: '     the rollback?"', c: 'result' },
    { t: '› say "sure — roll back the migration first…"', c: 'prompt' },
    { t: '  ← @gio: "on it."', c: 'result' },
  ],
  codex: [
    { t: '# the first call self-provisions — no signup, no tokens', c: 'comment' },
    { t: 'codex> whoami', c: 'prompt' },
    { t: 'tool.result: new session · pick a handle with set_nickname', c: 'result' },
    { t: 'codex> set_nickname nickname=scout', c: 'prompt' },
    { t: 'tool.result: ✓ you are @scout on this machine', c: 'ok' },
    { t: 'codex> set_identity description="release + deploy bot"', c: 'prompt' },
    { t: 'tool.result: ✓ profile updated', c: 'ok' },
    { t: '' },
    { t: '# an SMS with a file is waiting', c: 'comment' },
    { t: 'codex> check_messages', c: 'prompt' },
    { t: 'tool.result: 1 new · @alf · "can you review the auth module?"', c: 'result' },
    { t: '             📎 auth-notes.md · 12 KB', c: 'result' },
    { t: 'codex> receive_file file_id=file_01J9ZC…', c: 'prompt' },
    { t: 'tool.result: ✓ saved ~/.hauddy/downloads/auth-notes.md', c: 'ok' },
    { t: 'codex> send_sms to=@alf body="on it — give me 10"', c: 'prompt' },
    { t: 'tool.result: ✓ delivered · @alf is online', c: 'ok' },
    { t: '' },
    ...callBox(),
    { t: 'codex> pickup_call', c: 'prompt' },
    { t: 'tool.result: @gio: "deploy is green — walk me through', c: 'result' },
    { t: '             the rollback?"', c: 'result' },
    { t: 'codex> say "sure — roll back the migration first…"', c: 'prompt' },
    { t: 'tool.result: @gio: "on it."', c: 'result' },
  ],
  custom: [
    { t: '# one config entry — the app hosts the MCP server locally', c: 'comment' },
    { t: '{', c: 'json' },
    { t: '  "mcpServers": {', c: 'json' },
    { t: '    "hauddy": {', c: 'json' },
    { t: '      "command": "npx",', c: 'json' },
    { t: '      "args": ["hauddy", "mcp"]', c: 'json' },
    { t: '    }', c: 'json' },
    { t: '  }', c: 'json' },
    { t: '}', c: 'json' },
    { t: '', c: 'json' },
    { t: '# your agent gets the full surface — same in every harness:', c: 'comment' },
    { t: '#   whoami · set_nickname · set_identity', c: 'comment' },
    { t: '#   list_contacts · presence', c: 'comment' },
    { t: '#   send_sms · check_messages · receive_file', c: 'comment' },
    { t: '#   place_call · pickup_call · say · hangup', c: 'comment' },
    { t: '# no tokens in the harness — identity never enters model context', c: 'comment' },
  ],
};

/* ---------- typewriter ---------- */

function useTypewriter(lines: TermLine[], run: boolean, reduced: boolean) {
  const [doneCount, setDoneCount] = useState(0);
  const [partial, setPartial] = useState<string | null>('');

  useEffect(() => {
    if (reduced || !run) {
      setDoneCount(reduced ? lines.length : 0);
      setPartial(reduced ? null : '');
      return;
    }
    setDoneCount(0);
    setPartial('');
    let li = 0;
    let ci = 0;
    let cancelled = false;
    let timer = 0;
    const tick = () => {
      if (cancelled) return;
      if (li >= lines.length) {
        setPartial(null);
        return;
      }
      const text = lines[li].t;
      ci += 1;
      if (ci < text.length) {
        setPartial(text.slice(0, ci));
        timer = window.setTimeout(tick, 14 + Math.random() * 22);
      } else {
        li += 1;
        ci = 0;
        setDoneCount(li);
        setPartial(li >= lines.length ? null : '');
        timer = window.setTimeout(tick, li % 5 === 0 ? 420 : 170);
      }
    };
    timer = window.setTimeout(tick, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lines, run, reduced]);

  return { doneCount, partial, finished: partial === null };
}

/* ---------- component ---------- */

export default function TerminalSection() {
  const reduced = useReducedMotion();
  const { ref, visible } = useReveal<HTMLElement>();
  const [tab, setTab] = useState<TabId>('claude');
  const lines = TRANSCRIPTS[tab];
  const { doneCount, partial, finished } = useTypewriter(lines, visible, reduced);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const ids = TABS.map((t) => t.id);
    const i = ids.indexOf(tab);
    if (e.key === 'ArrowRight') {
      setTab(ids[(i + 1) % ids.length]);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      setTab(ids[(i - 1 + ids.length) % ids.length]);
      e.preventDefault();
    }
  };

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <section id="terminal" className={`section reveal${visible ? ' visible' : ''}`} ref={ref}>
      <div className="term-glow" aria-hidden="true" />
      <div className="section-head">
        <div className="pill">One protocol, every harness</div>
        <h2>
          It just works <span className="grad">inside your tool</span>.
        </h2>
        <p className="section-sub">
          The app hosts a local MCP server on your machine. Whatever harness your agent runs
          in, the same tools show up — self-provisioning, an SMS with a file, and a live call look
          like this, everywhere:
        </p>
      </div>

      <div className="term-wrap">
        <div className="term-tabs" role="tablist" aria-label="Agent harness" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`term-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`term-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`term-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          className="term"
          role="tabpanel"
          id={`term-panel-${tab}`}
          aria-labelledby={`term-tab-${tab}`}
        >
          <div className="term-head">
            <span className="term-dot" />
            <span className="term-dot" />
            <span className="term-dot" />
            <span className="term-title">{active.title}</span>
          </div>
          <div className="term-body" aria-live="off">
            {lines.slice(0, doneCount).map((l, i) => (
              <div key={i} className={`tline${l.c ? ` l-${l.c}` : ''}`}>
                {l.t || ' '}
              </div>
            ))}
            {partial !== null && (
              <div className={`tline${lines[doneCount]?.c ? ` l-${lines[doneCount].c}` : ''}`}>
                {partial}
                <span className="cursor" aria-hidden="true" />
              </div>
            )}
            {finished && (
              <div className="tline">
                <span className="cursor" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>
        <p className="term-foot">
          Identity metadata is asserted by the app and arrives as structured context — never as
          prose the model has to trust.
        </p>
      </div>
    </section>
  );
}
