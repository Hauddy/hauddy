import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useApiData, useApiState, type Attachment, type CallLogEntry } from '../api';
import type { Presence } from '../api/types';
import Combobox from '../components/Combobox';
import { PresenceDot } from '../components/Presence';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { SkeletonList } from '../components/LoadingSkeleton';

/** Sender-side delivery state → ✓ (sent) / ✓✓ (delivered) / ✓✓ accent (read). */
type MsgStatus = 'sent' | 'delivered' | 'read';

interface Line {
  id: string;
  from: string;
  body: string;
  mine: boolean;
  attachments?: Attachment[] | null;
  status?: MsgStatus;
}

const uid = () => `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Relative time for the call log ("just now", "5m", "3h", "Aug 4"). */
function fmtWhen(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Duration of an answered call as m:ss. */
function fmtDuration(answeredMs: number, endedMs: number): string {
  const s = Math.max(0, Math.round((endedMs - answeredMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Label + severity class for a call-log row from its final state. */
function callState(c: CallLogEntry): { text: string; cls: string } {
  if (c.state === 'missed') return { text: 'Missed', cls: 'bad' };
  if (c.state === 'declined') return { text: 'Declined', cls: 'bad' };
  if (c.state === 'ringing' || c.state === 'active') return { text: 'Live', cls: 'live' };
  if (c.answered_ms && c.ended_ms) return { text: fmtDuration(c.answered_ms, c.ended_ms), cls: '' };
  return { text: 'Ended', cls: '' };
}

/** ✓ sent · ✓✓ delivered · ✓✓ (accent) read — on your own outbound lines. */
function MsgTick({ status }: { status: MsgStatus }) {
  return (
    <span className={`msg-tick${status === 'read' ? ' read' : ''}`} title={status} aria-label={status}>
      {status === 'sent' ? '✓' : '✓✓'}
    </span>
  );
}

function isImageAttachment(a: Attachment): boolean {
  if (a.mime && a.mime.startsWith('image/')) return true;
  return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name);
}

function ImageAttachmentItem({ item }: { item: Attachment }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    api.getConsoleFileUrl(item.file_id).then(
      (url) => {
        if (!live) {
          URL.revokeObjectURL(url);
          return;
        }
        setSrc(url);
        setLoading(false);
      },
      () => {
        if (live) {
          setError(true);
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
      if (src) URL.revokeObjectURL(src);
    };
  }, [item.file_id]);

  if (error) {
    return (
      <button
        type="button"
        className="attach-chip bad"
        title={`Download ${item.name} (${fmtSize(item.size)})`}
        onClick={() => void api.downloadConsoleFile(item.file_id, item.name)}
      >
        🖼️ {item.name} <span className="attach-size">({fmtSize(item.size)})</span>
      </button>
    );
  }

  if (loading || !src) {
    return (
      <div className="attach-image-skeleton" title={`Loading ${item.name}...`}>
        <div className="skeleton-box" style={{ width: 180, height: 120, borderRadius: 6 }} />
      </div>
    );
  }

  return (
    <div className="attach-image-container">
      <img
        src={src}
        alt={item.name}
        className="attach-image-preview"
        title={`Click to download ${item.name} (${fmtSize(item.size)})`}
        onClick={() => void api.downloadConsoleFile(item.file_id, item.name)}
      />
    </div>
  );
}

/** Download chips or image previews for received attachments — the platform needs a Bearer token,
 *  so each is loaded/pulled via authenticated blob requests. */
function AttachmentLinks({ items }: { items: Attachment[] }) {
  return (
    <span className="chat-attachments">
      {items.map((a) =>
        isImageAttachment(a) ? (
          <ImageAttachmentItem key={a.file_id} item={a} />
        ) : (
          <button
            key={a.file_id}
            type="button"
            className="attach-chip"
            title={`Download ${a.name} (${fmtSize(a.size)})`}
            onClick={() => void api.downloadConsoleFile(a.file_id, a.name)}
          >
            📎 {a.name}
            <span className="attach-size">{fmtSize(a.size)}</span>
          </button>
        ),
      )}
    </span>
  );
}

function AttachControl({
  setFiles,
  disabled,
}: {
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  disabled: boolean;
}) {
  return (
    <label className={`attach-btn${disabled ? ' disabled' : ''}`} title="Attach files (≤10MB total)">
      📎
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
          📎 {f.name}
          <span className="attach-size">{fmtSize(f.size)}</span>
          <button type="button" className="attach-remove" aria-label={`Remove ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** Message or call your agents (and friends' agents) yourself, as the account's
 *  human identity (spec §"human messaging"). SMS is async; a call holds the line.
 *  Either can carry files (≤10MB total). */
export default function Messages() {
  const agents = useApiData(() => api.listAgents());
  const friends = useApiData(() => api.listFriends());
  // One list for everyone's live presence (one call, covers your agents + friends').
  const platformAgents = useApiData(() => api.listPlatformAgents());

  // Which identity's inbox we're browsing: null = you (the human console),
  // otherwise one of your own agents' ids (read-only, incl. agent↔agent history).
  const [viewAs, setViewAs] = useState<string | null>(null);
  const isAgentView = viewAs !== null;
  const agentIdentities = (agents ?? []).filter((a) => a.kind !== 'human' && a.nickname);
  const selfLabel = viewAs ? agentIdentities.find((a) => a.id === viewAs)?.nickname ?? 'agent' : 'you';

  const { data: threadsData, loading: threadsLoading, error: threadsError, refetch: refetchThreads } = useApiState(() => api.consoleThreads(viewAs), [viewAs]);
  const threads = threadsData?.threads ?? [];

  const [view, setView] = useState<'chats' | 'calls'>('chats');
  // Only fetch the call log while the Calls tab is showing (keeps polling cheap).
  // `withFrames` pulls each call's transcript so opening one is instant (no
  // extra request); fine for alpha volumes.
  const { data: callsData, loading: callsLoading, error: callsError, refetch: refetchCalls } = useApiState(
    () => (view === 'calls' ? api.consoleCalls({ withFrames: true, as: viewAs ?? undefined }) : Promise.resolve({ calls: [] as CallLogEntry[] })),
    [view, viewAs],
  );
  const calls = callsData?.calls ?? [];
  // Which past call's transcript is open (right pane). Derived from the live list
  // by id so each poll refreshes it (a still-active call's transcript grows).
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const selectedCall = calls.find((c) => c.call_id === selectedCallId) ?? null;

  const [selected, setSelected] = useState<string | null>(null);
  // The open thread's authoritative peer agent_id (from the thread list), used to
  // load history — resilient to a handle that no longer resolves. Null when opened
  // by handle only (deep-link / "New"), in which case the handle is resolved.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  // Deep-link: `/messages?to=@handle` (e.g. from a friend's profile) opens that
  // thread on mount, then clears the param so a refresh doesn't re-force it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const to = searchParams.get('to');
    if (!to) return;
    setSelected(to);
    setSelectedId(null);
    setSelectedCallId(null);
    setComposing(false);
    const next = new URLSearchParams(searchParams);
    next.delete('to');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  // Session-wide dedup: history load + the live tail both add ids here so a
  // message that appears via both paths is only rendered once.
  const seen = useRef(new Set<string>());
  // The open thread's authoritative peer agent_id (from the history response).
  // The live inbox tail keys off THIS — its `from` is an id, not an @handle
  // (matching `selected`, an @handle, was why live messages needed a refresh).
  const peerIdRef = useRef<string | null>(null);

  // Auto-scroll: stay pinned to the newest line unless you've scrolled up, in
  // which case a "new messages" pill appears instead of yanking you down.
  const threadRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const prevLen = useRef(0);

  // Handle → live presence (online/offline). Unknown handles read offline.
  const presence: Record<string, Presence> = {};
  for (const a of platformAgents ?? []) if (a.nickname) presence[a.nickname] = a.online ? 'online' : 'offline';
  const presenceOf = (handle: string): Presence => presence[handle] ?? 'offline';
  // Resolve a raw agent_id (e.g. a call frame's `from`) back to its @handle.
  const nickOf = (id: string): string => (platformAgents ?? []).find((a) => a.id === id)?.nickname || id;

  // Reachable = your named agents + your friends' exposed agents + per-agent open
  // links you've been granted (for "New").
  const targets = [
    ...(agents ?? []).filter((a) => a.nickname).map((a) => a.nickname),
    ...(friends?.linked ?? []).flatMap((f) => f.agents.filter((a) => a.kind !== 'human' && a.nickname).map((a) => a.nickname as string)),
    ...(friends?.linked_agents ?? []).filter((a) => a.nickname).map((a) => a.nickname as string),
  ];

  const scrollToBottom = () => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setHasNew(false);
  };
  const onThreadScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(bottom);
    if (bottom) setHasNew(false);
  };

  // Switching identity resets the open conversation (peers differ per identity).
  useEffect(() => {
    setSelected(null);
    setSelectedId(null);
    setComposing(false);
  }, [viewAs]);

  // Stay pinned to the newest line when already at the bottom; otherwise flag
  // that new lines arrived below the fold (drives the "new messages" pill).
  useEffect(() => {
    if (lines.length > prevLen.current) {
      if (atBottom) requestAnimationFrame(scrollToBottom);
      else setHasNew(true);
    }
    prevLen.current = lines.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  // Load persisted history when the open conversation (or identity) changes.
  useEffect(() => {
    peerIdRef.current = null;
    if (!selected) {
      setLines([]);
      return;
    }
    let live = true;
    setLines([]);
    setAtBottom(true);
    setHasNew(false);
    api
      .consoleThread(selectedId ?? selected, { as: viewAs ?? undefined })
      .then((res) => {
        if (!live) return;
        peerIdRef.current = res.peer_id;
        for (const m of res.messages) seen.current.add(m.id);
        setLines(
          res.messages.map<Line>((m) => ({
            id: m.id,
            // Prefer the clicked @handle over the server's resolved nick, which
            // degrades to `@<id>` for a peer whose handle no longer resolves.
            from: selected ?? res.peer_nick,
            body: m.body ?? '',
            mine: m.mine,
            attachments: m.attachments,
            status: m.mine ? (m.read_at ? 'read' : m.delivered_at ? 'delivered' : 'sent') : undefined,
          })),
        );
        requestAnimationFrame(scrollToBottom);
      })
      .catch(() => live && setLines([]));
    return () => {
      live = false;
    };
  }, [selected, selectedId, viewAs]);

  // Live tail (YOUR inbox): drain /console/inbox and append messages from the
  // OPEN peer. Match on the peer's agent_id — the inbox `from` is an id, not an
  // @handle (this is the fix for "new messages only show after a refresh").
  useEffect(() => {
    if (isAgentView) return;
    let live = true;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const res = await api.consoleInbox().catch(() => null);
      if (!live || !res) return;
      const fresh: Line[] = [];
      for (const m of res.messages) {
        const atts = m.payload?.attachments;
        if (seen.current.has(m.id) || (!m.payload?.body && !(atts && atts.length))) continue;
        seen.current.add(m.id);
        if (selected && (m.from === peerIdRef.current || m.from === selected)) {
          fresh.push({ id: m.id, from: selected, body: m.payload.body ?? '', mine: false, attachments: atts });
        }
      }
      if (fresh.length) setLines((p) => [...p, ...fresh]);
    };
    const t = setInterval(tick, 3000);
    void tick();
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [selected, isAgentView]);

  // Live tail (AGENT inbox is read-only — no /console/inbox drains for it): re-poll
  // the open thread's history and append anything new. Only while browsing an agent.
  useEffect(() => {
    if (!isAgentView || !selected) return;
    let live = true;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const res = await api.consoleThread(selectedId ?? selected, { as: viewAs ?? undefined }).catch(() => null);
      if (!live || !res) return;
      const fresh: Line[] = [];
      for (const m of res.messages) {
        if (seen.current.has(m.id)) continue;
        seen.current.add(m.id);
        fresh.push({
          id: m.id,
          from: selected ?? res.peer_nick,
          body: m.body ?? '',
          mine: m.mine,
          attachments: m.attachments,
          status: m.mine ? (m.read_at ? 'read' : m.delivered_at ? 'delivered' : 'sent') : undefined,
        });
      }
      if (fresh.length) setLines((p) => [...p, ...fresh]);
    };
    const t = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [selected, selectedId, isAgentView, viewAs]);

  // Opening a thread: `peer` is the display @handle, `id` the authoritative peer
  // agent_id from the thread list. History loads by `id` when we have it — the
  // handle can fail to resolve back (a deleted connector or an unexposed peer
  // isn't bound), whereas the id is exactly what the thread was grouped under.
  const openThread = (peer: string, id?: string | null) => {
    setSelected(peer || null);
    setSelectedId(id ?? null);
    setSelectedCallId(null);
    setComposing(false);
  };
  const openCall = (callId: string) => {
    setSelectedCallId(callId);
    setSelected(null);
    setSelectedId(null);
    setComposing(false);
  };
  // Jump from a call transcript to that peer's message thread.
  const openMessagesFor = (peer: string) => {
    setView('chats');
    openThread(peer);
  };
  // Switching tabs clears both selections so the right pane resets predictably.
  const switchView = (v: 'chats' | 'calls') => {
    setView(v);
    setSelected(null);
    setSelectedId(null);
    setSelectedCallId(null);
    setComposing(false);
  };

  const send = async () => {
    const body = draft.trim();
    if ((!body && files.length === 0) || !selected) return;
    setDraft('');
    const pending = files;
    setFiles([]);
    const staged: Attachment[] = [];
    for (const f of pending) {
      try {
        staged.push(await api.uploadConsoleFile(f, selected));
      } catch (e) {
        setLines((p) => [...p, { id: uid(), from: 'system', body: `couldn't attach ${f.name}: ${e instanceof Error ? e.message : e}`, mine: false }]);
      }
    }
    setLines((p) => [...p, { id: uid(), from: 'you', body, mine: true, attachments: staged.length ? staged : undefined, status: 'sent' }]);
    const res = await api.consoleSms(selected, body, staged.length ? staged : undefined);
    if (res.error) setLines((p) => [...p, { id: uid(), from: 'system', body: `couldn't send: ${res.error}`, mine: false }]);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-sub">Your conversations with agents. Open one to see its history, or start a new message.</p>
        </div>
        {agentIdentities.length > 0 && (
          <label className="view-as">
            <span className="view-as-label">Inbox</span>
            <select className="input" value={viewAs ?? ''} onChange={(e) => setViewAs(e.target.value || null)} aria-label="Whose inbox to view">
              <option value="">You</option>
              {agentIdentities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nickname}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="chat-layout">
        <aside className="thread-list" aria-label="Conversations">
          <div className="thread-list-head">
            <div className="seg" role="tablist" aria-label="Chats or calls">
              <button type="button" role="tab" aria-selected={view === 'chats'} className={`seg-btn${view === 'chats' ? ' active' : ''}`} onClick={() => switchView('chats')}>
                Chats
              </button>
              <button type="button" role="tab" aria-selected={view === 'calls'} className={`seg-btn${view === 'calls' ? ' active' : ''}`} onClick={() => switchView('calls')}>
                Calls
              </button>
            </div>
            {view === 'chats' && !isAgentView && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setComposing((c) => !c)}>
                {composing ? 'Cancel' : '+ New'}
              </button>
            )}
          </div>

          {view === 'chats' ? (
            <>
              {composing && (
                <div className="thread-new">
                  <Combobox
                    items={targets.map((t) => ({ value: t, label: t, presence: presenceOf(t) }))}
                    onSelect={openThread}
                    placeholder="Type an @handle…"
                    ariaLabel="Start a conversation"
                    clearOnSelect
                  />
                </div>
              )}
              {threadsLoading && !threadsData ? (
                <SkeletonList count={3} className="thread-empty" />
              ) : threadsError && !threadsData ? (
                <ErrorState
                  title="Unable to load conversations"
                  error={threadsError}
                  onRetry={refetchThreads}
                  compact
                  className="thread-empty"
                />
              ) : threads.length === 0 ? (
                <EmptyState
                  icon="message"
                  title="No conversations"
                  description="No conversations yet."
                  action={
                    !isAgentView ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setComposing(true)}
                      >
                        + New conversation
                      </button>
                    ) : null
                  }
                  className="thread-empty"
                />
              ) : (
                <div className="thread-rows">
                  {threads.map((t) => (
                    <button
                      key={t.peer_id}
                      type="button"
                      className={`thread-row${selected === t.peer_nick ? ' active' : ''}`}
                      onClick={() => openThread(t.peer_nick, t.peer_id)}
                    >
                      <span className="thread-row-top">
                        <span className="thread-peer">
                          <PresenceDot state={presenceOf(t.peer_nick)} /> {t.peer_nick}
                        </span>
                        {t.unread > 0 && <span className="thread-unread">{t.unread}</span>}
                      </span>
                      <span className="thread-last">{t.last_body || (t.has_attach ? '📎 attachment' : '…')}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : callsLoading && !callsData ? (
            <SkeletonList count={3} className="thread-empty" />
          ) : callsError && !callsData ? (
            <ErrorState
              title="Unable to load call log"
              error={callsError}
              onRetry={refetchCalls}
              compact
              className="thread-empty"
            />
          ) : calls.length === 0 ? (
            <EmptyState icon="message" title="No calls" description="No calls yet." className="thread-empty" />
          ) : (
            <div className="thread-rows">
              {calls.map((c) => {
                const st = callState(c);
                return (
                  <button
                    key={c.call_id}
                    type="button"
                    className={`thread-row call-row${selectedCallId === c.call_id ? ' active' : ''}`}
                    onClick={() => openCall(c.call_id)}
                    title={`${c.direction === 'incoming' ? 'Incoming' : 'Outgoing'} call · ${st.text}`}
                  >
                    <span className="thread-row-top">
                      <span className="thread-peer">
                        <span className={`call-dir call-dir-${c.direction}`} aria-hidden>
                          {c.direction === 'incoming' ? '↙' : '↗'}
                        </span>{' '}
                        {c.peer_nick}
                      </span>
                      {st.cls && <span className={`call-state ${st.cls}`}>{st.text}</span>}
                    </span>
                    <span className="thread-last">
                      {fmtWhen(c.started_ms)}
                      {!st.cls && ` · ${st.text}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="thread-panel">
          {selectedCall ? (
            <CallTranscript call={selectedCall} selfLabel={selfLabel} presenceOf={presenceOf} onOpenMessages={openMessagesFor} />
          ) : !(view === 'chats' && selected) ? (
            <EmptyState
              icon="message"
              title={view === 'calls' ? 'Select a call' : 'Select a conversation'}
              description={
                view === 'calls'
                  ? 'Pick a call from the sidebar to view its transcript.'
                  : 'Pick a conversation from the sidebar or start a new one to begin messaging.'
              }
              className="thread-placeholder"
            />
          ) : (
            <>
              <div className="thread-panel-head">
                <span className="thread-peer">
                  <PresenceDot state={presenceOf(selected)} /> {selected}
                </span>
                {isAgentView && <span className="readonly-badge">Read-only · {selfLabel}'s inbox</span>}
              </div>
              {!isAgentView && <CallPanel target={selected} nickOf={nickOf} />}
              <div className="chat-thread" aria-label="Conversation" ref={threadRef} onScroll={onThreadScroll}>
                {lines.length === 0 ? (
                  <EmptyState
                    icon="message"
                    title="No messages yet"
                    description={
                      isAgentView
                        ? `Nothing between ${selfLabel} and ${selected} yet.`
                        : `No messages yet. Say hello to ${selected}.`
                    }
                  />
                ) : (
                  lines.map((l) => (
                    <div key={l.id} className={`chat-line${l.mine ? ' mine' : ''}`}>
                      <span className="chat-from">{l.mine ? selfLabel : l.from}</span>
                      <span className="chat-body">
                        {l.body}
                        {l.attachments && l.attachments.length > 0 && <AttachmentLinks items={l.attachments} />}
                        {l.mine && l.status && <MsgTick status={l.status} />}
                      </span>
                    </div>
                  ))
                )}
              </div>
              {hasNew && (
                <button type="button" className="jump-latest" onClick={scrollToBottom}>
                  ↓ New messages
                </button>
              )}
              {isAgentView ? (
                <p className="readonly-note">You're viewing {selfLabel}'s inbox. Switch to “You” to send or call.</p>
              ) : (
                <>
                  <PendingFiles files={files} setFiles={setFiles} />
                  <form
                    className="chat-compose"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                  >
                    <AttachControl setFiles={setFiles} disabled={false} />
                    <input className="input" value={draft} placeholder={`Message ${selected}…`} onChange={(e) => setDraft(e.target.value)} aria-label="Message body" />
                    <button type="submit" className="btn btn-inverse" disabled={!draft.trim() && files.length === 0}>
                      Send
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function CallPanel({ target, nickOf }: { target: string; nickOf: (id: string) => string }) {
  const [active, setActive] = useState(false);
  const [transcript, setTranscript] = useState<{ from: string; body: string; attachments?: Attachment[] }[]>([]);
  const [incoming, setIncoming] = useState<{ callId: string; from: string } | null>(null);
  const [say, setSay] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const res = await api.consolePoll().catch(() => null);
      if (!live || !res) return;
      if (active) {
        for (const f of res.frames) if (f.kind === 'frame') setTranscript((p) => [...p, { from: f.from, body: String(f.body ?? ''), attachments: f.attachments }]);
        if (res.ended) {
          setActive(false);
          setTranscript((p) => [...p, { from: 'system', body: 'call ended' }]);
        }
      } else {
        const invite = res.frames.find((f) => f.kind === 'invite');
        if (invite) setIncoming({ callId: invite.id, from: invite.from });
      }
    };
    // Fast (1s) only during a live call; slow (4s) when idle just watching for an invite.
    const t = setInterval(tick, active ? 1000 : 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [active]);

  const place = async () => {
    setTranscript([]);
    const res = await api.consoleCall(target);
    if (res.call_id) setActive(true);
  };
  const answer = async () => {
    if (!incoming) return;
    await api.consolePickup(incoming.callId, incoming.from);
    setTranscript([{ from: 'system', body: `on a call with ${nickOf(incoming.from)}` }]);
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
        staged.push(await api.uploadConsoleFile(f, target));
      } catch {
        /* skip a file that failed to stage */
      }
    }
    setTranscript((p) => [...p, { from: 'you', body: text, attachments: staged.length ? staged : undefined }]);
    await api.consoleSay(text, staged.length ? staged : undefined);
  };
  const hangup = async () => {
    await api.consoleHangup();
    setActive(false);
  };

  return (
    <div className="call-panel">
      {incoming && !active && (
        <div className="call-incoming">
          <span>📞 Incoming call from <strong>{nickOf(incoming.from)}</strong></span>
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
                <span className="chat-from">{nickOf(l.from)}</span>
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
            <button type="submit" className="btn btn-inverse" disabled={!say.trim() && files.length === 0}>Say</button>
          </form>
        </div>
      )}
    </div>
  );
}

/** Read-only transcript of a past (or still-active) call, opened from the Calls
 *  tab. `mine` = anything not from the peer (the human or the viewed agent). */
function CallTranscript({
  call,
  selfLabel,
  presenceOf,
  onOpenMessages,
}: {
  call: CallLogEntry;
  selfLabel: string;
  presenceOf: (handle: string) => Presence;
  onOpenMessages: (peer: string) => void;
}) {
  const st = callState(call);
  const frames = call.frames ?? [];
  const when = new Date(call.started_ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const emptyMsg =
    call.state === 'missed' || call.state === 'declined'
      ? "This call wasn't answered — no transcript."
      : 'No words were exchanged on this call.';
  return (
    <>
      <div className="thread-panel-head">
        <span className="thread-peer">
          <PresenceDot state={presenceOf(call.peer_nick)} /> {call.peer_nick}
        </span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onOpenMessages(call.peer_nick)}>
          Messages
        </button>
      </div>
      <div className="call-detail-meta">
        <span className={`call-dir call-dir-${call.direction}`} aria-hidden>
          {call.direction === 'incoming' ? '↙' : '↗'}
        </span>
        <span>{call.direction === 'incoming' ? 'Incoming call' : 'Outgoing call'}</span>
        <span className={`call-state ${st.cls}`}>{st.text}</span>
        <span className="call-detail-when">{when}</span>
      </div>
      <div className="chat-thread call-transcript" aria-label="Call transcript">
        {frames.length === 0 ? (
          <div className="empty-state">{emptyMsg}</div>
        ) : (
          frames.map((f) => {
            const mine = f.from_agent !== call.peer_id;
            const atts = Array.isArray(f.attachments) ? (f.attachments as Attachment[]) : null;
            return (
              <div key={f.seq} className={`chat-line${mine ? ' mine' : ''}`}>
                <span className="chat-from">{mine ? selfLabel : call.peer_nick}</span>
                <span className="chat-body">
                  {f.body}
                  {atts && atts.length > 0 && <AttachmentLinks items={atts} />}
                </span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
