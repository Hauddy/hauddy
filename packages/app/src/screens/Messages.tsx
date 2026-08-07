import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, useApiData } from '../api';
import type { Attachment, PoolContact } from '../api/types';
import Combobox, { type ComboItem } from '../components/Combobox';
import { IconPlus, IconSend } from '../components/icons';
import { PresenceDot } from '../components/Presence';

interface Line {
  from: string;
  body: string;
  ts: string;
  mine: boolean;
  attachments?: Attachment[];
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Download-link chips for received attachments (served by the daemon proxy). */
function AttachmentLinks({ items }: { items: Attachment[] }) {
  return (
    <span className="chat-attachments">
      {items.map((a) => (
        <a
          key={a.file_id}
          className="attach-chip"
          href={api.humanFileUrl(a.file_id)}
          download={a.name}
          title={`Download ${a.name} (${fmtSize(a.size)})`}
        >
          <IconPlus size={12} /> {a.name}
          <span className="attach-size">{fmtSize(a.size)}</span>
        </a>
      ))}
    </span>
  );
}

/** Paperclip picker + removable chips for files staged to send. */
function AttachControl({
  setFiles,
  disabled,
}: {
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  disabled: boolean;
}) {
  return (
    <label className={`attach-btn${disabled ? ' disabled' : ''}`} title="Attach files (≤10MB total)">
      <IconPlus size={16} />
      <input
        type="file"
        multiple
        hidden
        disabled={disabled}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          setFiles((prev) => [...prev, ...picked]);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function PendingFiles({ files, setFiles }: { files: File[]; setFiles: React.Dispatch<React.SetStateAction<File[]>> }) {
  if (files.length === 0) return null;
  return (
    <div className="compose-attachments">
      {files.map((f, i) => (
        <span key={i} className="attach-chip pending">
          <IconPlus size={12} /> {f.name}
          <span className="attach-size">{fmtSize(f.size)}</span>
          <button
            type="button"
            className="attach-remove"
            aria-label={`Remove ${f.name}`}
            onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
interface Incoming {
  callId: string;
  from: string;
  hub: 'local' | 'platform';
}

/** Message or call agents yourself (spec §"human messaging"). You're a console
 *  identity on the hub — SMS is async, a call holds the line in real time. */
export default function Messages() {
  const pool = useApiData(() => api.listPool());
  const location = useLocation();
  const preTo = (location.state as { to?: string } | null)?.to ?? null;
  const [target, setTarget] = useState<string | null>(preTo);
  const [lines, setLines] = useState<Line[]>([]);
  const seen = useRef(new Set<string>());
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  // Poll the console inbox for agent → you replies.
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const res = await api.humanInbox().catch(() => null);
      if (!live || !res) return;
      const fresh: Line[] = [];
      for (const m of res.messages) {
        const atts = m.payload?.attachments;
        if (seen.current.has(m.id) || (!m.payload?.body && !(atts && atts.length))) continue;
        seen.current.add(m.id);
        fresh.push({ from: m.from, body: m.payload.body ?? '', ts: m.ts, mine: false, attachments: atts });
      }
      if (fresh.length) setLines((prev) => [...prev, ...fresh]);
    };
    const t = setInterval(tick, 1500);
    void tick();
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const send = async () => {
    const body = draft.trim();
    if ((!body && files.length === 0) || !target) return;
    setDraft('');
    const pending = files;
    setFiles([]);
    const staged: Attachment[] = [];
    for (const f of pending) {
      try {
        staged.push(await api.uploadHumanFile(f, target));
      } catch (e) {
        setLines((prev) => [...prev, { from: 'system', body: `couldn't attach ${f.name}: ${e instanceof Error ? e.message : e}`, ts: new Date().toISOString(), mine: false }]);
      }
    }
    setLines((prev) => [...prev, { from: 'you', body, ts: new Date().toISOString(), mine: true, attachments: staged.length ? staged : undefined }]);
    const res = await api.humanSms(target, body, staged.length ? staged : undefined);
    if (res.error) setLines((prev) => [...prev, { from: 'system', body: `couldn't send: ${res.error}`, ts: new Date().toISOString(), mine: false }]);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-sub">Text or call your agents yourself. Pick who, then send a message or start a call.</p>
        </div>
      </div>

      <TargetPicker pool={pool} target={target} onPick={setTarget} />

      {target && (
        <CallPanel target={target} onLine={(l) => setLines((prev) => [...prev, l])} />
      )}

      <section className="detail-section">
        <div className="chat-thread" aria-label="Conversation">
          {lines.length === 0 ? (
            <div className="empty-state book-empty">No messages yet.{target ? ` Say hello to ${target}.` : ' Pick an agent above.'}</div>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={`chat-line${l.mine ? ' mine' : ''}`}>
                <span className="chat-from">{l.mine ? 'you' : l.from}</span>
                <span className="chat-body">
                  {l.body}
                  {l.attachments && l.attachments.length > 0 && <AttachmentLinks items={l.attachments} />}
                </span>
              </div>
            ))
          )}
        </div>
        <PendingFiles files={files} setFiles={setFiles} />
        <form
          className="chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <AttachControl setFiles={setFiles} disabled={!target} />
          <input
            className="input"
            value={draft}
            placeholder={target ? `Message ${target}…` : 'Pick an agent first'}
            disabled={!target}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Message body"
          />
          <button type="submit" className="btn btn-primary" disabled={!target || (!draft.trim() && files.length === 0)}>
            <IconSend size={15} /> Send
          </button>
        </form>
      </section>
    </>
  );
}

function TargetPicker({ pool, target, onPick }: { pool: PoolContact[] | undefined; target: string | null; onPick: (h: string) => void }) {
  const current = pool?.find((c) => c.handle === target);
  const items: ComboItem[] = (pool ?? []).map((c) => ({
    value: c.handle,
    label: c.handle,
    description: c.description ?? undefined,
    presence: c.presence,
  }));

  return (
    <section className="detail-section">
      <h2 className="section-title">To</h2>
      {pool === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : pool.length === 0 ? (
        <div className="empty-state book-empty">No agents to message yet.</div>
      ) : (
        <div className="recipient-row">
          <Combobox
            items={items}
            onSelect={onPick}
            initialQuery={target ?? ''}
            placeholder="Type a handle to message…"
            ariaLabel="Recipient"
          />
          {current && (
            <span className="recipient-current">
              <PresenceDot state={current.presence} /> {current.handle}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** Live call: place → hold the line (poll frames) → say → hangup. Also answers
 *  an incoming call (an agent ringing you) when idle. */
function CallPanel({ target, onLine }: { target: string; onLine: (l: Line) => void }) {
  const [active, setActive] = useState(false);
  const [transcript, setTranscript] = useState<{ from: string; body: string; attachments?: Attachment[] }[]>([]);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [say, setSay] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  // One poll loop: process the active call, or watch for an incoming ring.
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const res = await api.humanPollCall().catch(() => null);
      if (!live || !res) return;
      if (active) {
        for (const f of res.frames) {
          if (f.kind === 'frame') setTranscript((p) => [...p, { from: f.from, body: String(f.body ?? ''), attachments: f.attachments }]);
        }
        if (res.ended) {
          setActive(false);
          setTranscript((p) => [...p, { from: 'system', body: 'call ended' }]);
        }
      } else {
        const invite = res.frames.find((f) => f.kind === 'invite');
        if (invite) setIncoming({ callId: invite.id, from: invite.from, hub: invite.hub ?? 'local' });
      }
    };
    const t = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [active]);

  const place = async () => {
    setTranscript([]);
    const res = await api.humanCall(target);
    if (res.call_id) setActive(true);
    else onLine({ from: 'system', body: `call failed: ${res.error ?? 'no answer'}`, ts: new Date().toISOString(), mine: false });
  };
  const answer = async () => {
    if (!incoming) return;
    await api.humanPickup(incoming.callId, incoming.from, incoming.hub);
    setTranscript([{ from: 'system', body: `on a call with ${incoming.from}` }]);
    setIncoming(null);
    setActive(true);
  };
  const speak = async () => {
    const text = say.trim();
    if (!text && files.length === 0) return;
    setSay('');
    const pending = files;
    setFiles([]);
    const staged: Attachment[] = [];
    for (const f of pending) {
      try {
        staged.push(await api.uploadHumanFile(f, target));
      } catch {
        /* skip a file that failed to stage */
      }
    }
    setTranscript((p) => [...p, { from: 'you', body: text, attachments: staged.length ? staged : undefined }]);
    await api.humanSay(text, staged.length ? staged : undefined);
  };
  const hangup = async () => {
    await api.humanHangup();
    setActive(false);
  };

  return (
    <section className="detail-section call-panel">
      {incoming && !active && (
        <div className="call-incoming">
          <span>📞 Incoming call from <strong>{incoming.from}</strong></span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void answer()}>Answer</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIncoming(null)}>Ignore</button>
        </div>
      )}

      {!active ? (
        <button type="button" className="btn btn-ghost" onClick={() => void place()}>
          📞 Call {target}
        </button>
      ) : (
        <div className="call-live">
          <div className="call-head">
            <span className="presence presence-online">On call with {target}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void hangup()}>Hang up</button>
          </div>
          <div className="chat-thread call-transcript">
            {transcript.map((l, i) => (
              <div key={i} className={`chat-line${l.from === 'you' ? ' mine' : ''}`}>
                <span className="chat-from">{l.from}</span>
                <span className="chat-body">
                  {l.body}
                  {l.attachments && l.attachments.length > 0 && <AttachmentLinks items={l.attachments} />}
                </span>
              </div>
            ))}
          </div>
          <PendingFiles files={files} setFiles={setFiles} />
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void speak();
            }}
          >
            <AttachControl setFiles={setFiles} disabled={false} />
            <input className="input" value={say} placeholder="Say something…" onChange={(e) => setSay(e.target.value)} aria-label="Say on the call" />
            <button type="submit" className="btn btn-primary" disabled={!say.trim() && files.length === 0}>Say</button>
          </form>
        </div>
      )}
    </section>
  );
}
