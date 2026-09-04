import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useApiState, type Attachment, type ThreadCallFrame } from '../api';
import type { Presence } from '../api/types';
import Combobox from '../components/Combobox';
import { PresenceDot } from '../components/Presence';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { SkeletonList } from '../components/LoadingSkeleton';

/** Sender-side delivery state → ✓ (sent) / ✓✓ (delivered) / ✓✓ accent (read). */
type MsgStatus = 'sent' | 'delivered' | 'read';

export interface TimelineMessage {
  kind: 'message';
  id: string;
  from: string;
  body: string;
  mine: boolean;
  attachments?: Attachment[] | null;
  status?: MsgStatus;
  ts: number;
}

export interface TimelineCall {
  kind: 'call';
  id: string;
  direction: 'incoming' | 'outgoing';
  state: string;
  started_ms: number;
  answered_ms?: number | null;
  ended_ms?: number | null;
  end_reason?: string | null;
  frames: ThreadCallFrame[];
}

export type TimelineItem = TimelineMessage | TimelineCall;

const uid = () => `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Relative time for the thread / call ("just now", "5m", "3h", "Aug 4"). */
function fmtWhen(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Per-bubble clock: HH:MM today, "Wed HH:MM" this week, "Aug 4 HH:MM" older. */
function fmtMsgTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const hhmm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const diffDays = Math.floor((now.getTime() - ms) / 86_400_000);
  if (diffDays < 1 && d.getDate() === now.getDate()) return hhmm;
  if (diffDays < 7) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${hhmm}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${hhmm}`;
}

function fmtCallPreview(call: { state: string; duration_s?: number }): string {
  if (call.state === 'ended' && call.duration_s != null) {
    const m = Math.floor(call.duration_s / 60);
    const s = call.duration_s % 60;
    return `📞 Call · ${m}:${String(s).padStart(2, '0')}`;
  }
  return '📞 Missed call';
}

/** Duration of an answered call as m:ss. */
function fmtDuration(answeredMs: number, endedMs: number): string {
  const s = Math.max(0, Math.round((endedMs - answeredMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
  const urlRef = useRef<string | null>(null);

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
        urlRef.current = url;
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
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
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

/** Inline call block rendered inside the unified timeline */
function CallBlock({
  call,
  selfLabel,
  peerId,
  nickOf,
}: {
  call: TimelineCall;
  selfLabel: string;
  peerId: string | null;
  nickOf: (id: string) => string;
}) {
  const [expanded, setExpanded] = useState(call.frames.length <= 5);
  const isIncoming = call.direction === 'incoming';
  const when = new Date(call.started_ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const isMissed = call.state === 'missed';
  const isDeclined = call.state === 'declined';
  const isLive = call.state === 'ringing' || call.state === 'active';

  let statusText = '';
  let statusCls = '';
  if (isMissed) {
    statusText = 'Missed call · no answer';
    statusCls = 'bad';
  } else if (isDeclined) {
    statusText = 'Declined';
    statusCls = 'bad';
  } else if (isLive) {
    statusText = 'Live';
    statusCls = 'live';
  } else if (call.answered_ms && call.ended_ms) {
    statusText = fmtDuration(call.answered_ms, call.ended_ms);
  } else if (call.state === 'ended') {
    statusText = 'Ended';
  }

  const visibleFrames = expanded ? call.frames : call.frames.slice(0, 5);

  return (
    <div className={`call-block${isMissed ? ' call-missed' : isDeclined ? ' call-declined' : ''}`}>
      <div className="call-block-header">
        <span className="call-block-icon" aria-hidden>📞</span>
        <span className={`call-dir call-dir-${call.direction}`} aria-hidden>
          {isIncoming ? '↙' : '↗'}
        </span>
        <span className="call-block-title">{isIncoming ? 'Incoming call' : 'Outgoing call'}</span>
        <span className="call-block-sep">·</span>
        <span className="call-block-time">{when}</span>
        {statusText && (
          <>
            <span className="call-block-sep">·</span>
            <span className={`call-block-state${statusCls ? ` ${statusCls}` : ''}`}>{statusText}</span>
          </>
        )}
      </div>

      {call.frames.length > 0 && (
        <div className="call-block-frames">
          {visibleFrames.map((f, i) => {
            const isMine = f.from_agent === 'you' || (peerId ? f.from_agent !== peerId : false);
            const atts = Array.isArray(f.attachments) ? (f.attachments as Attachment[]) : null;
            return (
              <div key={f.seq ?? i} className={`chat-line${isMine ? ' mine' : ''}`}>
                <span className="chat-from">{isMine ? selfLabel : nickOf(f.from_agent)}</span>
                <span className="chat-body">
                  {f.body}
                  {atts && atts.length > 0 && <AttachmentLinks items={atts} />}
                </span>
              </div>
            );
          })}
          {call.frames.length > 5 && (
            <button
              type="button"
              className="call-expand-btn"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Show less ↑' : `Show full transcript (${call.frames.length} turns) ↓`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Message or call your agents (and friends' agents) yourself, as the account's
 *  human identity (spec §"human messaging"). SMS is async; a call holds the line.
 *  Either can carry files (≤10MB total). */
export default function Messages() {
  // Which identity's inbox we're browsing: null = you (the human console),
  // otherwise one of your own agents' ids (read-only, incl. agent↔agent history).
  const [viewAs, setViewAs] = useState<string | null>(null);

  // Single dashboard fetch replaces separate per-tick API calls (threads +
  // friends + agents + platform_agents), cutting DO requests by ~4×.
  const { data: dashboard, loading: threadsLoading, error: threadsError, refetch: refetchThreads } = useApiState(
    () => api.consoleDashboard({ as: viewAs }),
    [viewAs],
  );
  const agents = dashboard?.agents ?? [];
  const friends = dashboard?.friends;
  const platformAgents = dashboard?.platform_agents ?? [];
  const threads = dashboard?.threads ?? [];

  const isAgentView = viewAs !== null;
  const agentIdentities = agents.filter((a) => a.kind !== 'human' && a.nickname);
  const selfLabel = viewAs ? agentIdentities.find((a) => a.id === viewAs)?.nickname ?? 'agent' : 'you';

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
    setComposing(false);
    const next = new URLSearchParams(searchParams);
    next.delete('to');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  // ── call state (lifted from the old CallPanel, now session-wide) ──────────
  const [callActive, setCallActive] = useState(false);
  const [callTarget, setCallTarget] = useState<string | null>(null);
  const [callTranscript, setCallTranscript] = useState<{ from: string; body: string; attachments?: Attachment[] }[]>([]);
  const [callIncoming, setCallIncoming] = useState<{ callId: string; from: string } | null>(null);
  const [callSay, setCallSay] = useState('');
  const [callFiles, setCallFiles] = useState<File[]>([]);
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
    if (items.length > prevLen.current) {
      if (atBottom) requestAnimationFrame(scrollToBottom);
      else setHasNew(true);
    }
    prevLen.current = items.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Load persisted history when the open conversation (or identity) changes.
  useEffect(() => {
    peerIdRef.current = null;
    if (!selected) {
      setItems([]);
      return;
    }
    let live = true;
    setItems([]);
    setAtBottom(true);
    setHasNew(false);
    api
      .consoleThread(selectedId ?? selected, { as: viewAs ?? undefined })
      .then((res) => {
        if (!live) return;
        peerIdRef.current = res.peer_id;
        const timeline: TimelineItem[] = [];

        if (res.items && res.items.length > 0) {
          for (const item of res.items) {
            if (item.kind === 'message') {
              seen.current.add(item.id);
              timeline.push({
                kind: 'message',
                id: item.id,
                from: selected ?? res.peer_nick,
                body: item.body ?? '',
                mine: item.mine,
                attachments: item.attachments,
                status: item.mine ? (item.agent_read_at ? 'read' : item.delivered_at ? 'delivered' : 'sent') : undefined,
                ts: item.ts,
              });
            } else if (item.kind === 'call') {
              seen.current.add(item.call_id);
              timeline.push({
                kind: 'call',
                id: item.call_id,
                direction: item.direction,
                state: item.state,
                started_ms: item.started_ms,
                answered_ms: item.answered_ms,
                ended_ms: item.ended_ms,
                end_reason: item.end_reason,
                frames: item.frames ?? [],
              });
            }
          }
        } else {
          for (const m of res.messages) {
            seen.current.add(m.id);
            timeline.push({
              kind: 'message',
              id: m.id,
              from: selected ?? res.peer_nick,
              body: m.body ?? '',
              mine: m.mine,
              attachments: m.attachments,
              status: m.mine ? (m.agent_read_at ? 'read' : m.delivered_at ? 'delivered' : 'sent') : undefined,
              ts: m.ts,
            });
          }
        }

        setItems(timeline);
        requestAnimationFrame(scrollToBottom);
      })
      .catch(() => live && setItems([]));
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
      const fresh: TimelineItem[] = [];
      for (const m of res.messages) {
        const atts = m.payload?.attachments;
        if (seen.current.has(m.id) || (!m.payload?.body && !(atts && atts.length))) continue;
        seen.current.add(m.id);
        if (selected && (m.from === peerIdRef.current || m.from === selected)) {
          fresh.push({
            kind: 'message',
            id: m.id,
            from: selected,
            body: m.payload.body ?? '',
            mine: false,
            attachments: atts,
            ts: Date.now(),
          });
        }
      }
      if (fresh.length) setItems((p) => [...p, ...fresh]);
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
      const fresh: TimelineItem[] = [];

      if (res.items && res.items.length > 0) {
        for (const item of res.items) {
          if (item.kind === 'message') {
            if (seen.current.has(item.id)) continue;
            seen.current.add(item.id);
            fresh.push({
              kind: 'message',
              id: item.id,
              from: selected ?? res.peer_nick,
              body: item.body ?? '',
              mine: item.mine,
              attachments: item.attachments,
              status: item.mine ? (item.agent_read_at ? 'read' : item.delivered_at ? 'delivered' : 'sent') : undefined,
              ts: item.ts,
            });
          } else if (item.kind === 'call') {
            if (seen.current.has(item.call_id)) continue;
            seen.current.add(item.call_id);
            fresh.push({
              kind: 'call',
              id: item.call_id,
              direction: item.direction,
              state: item.state,
              started_ms: item.started_ms,
              answered_ms: item.answered_ms,
              ended_ms: item.ended_ms,
              end_reason: item.end_reason,
              frames: item.frames ?? [],
            });
          }
        }
      } else {
        for (const m of res.messages) {
          if (seen.current.has(m.id)) continue;
          seen.current.add(m.id);
          fresh.push({
            kind: 'message',
            id: m.id,
            from: selected ?? res.peer_nick,
            body: m.body ?? '',
            mine: m.mine,
            attachments: m.attachments,
            status: m.mine ? (m.agent_read_at ? 'read' : m.delivered_at ? 'delivered' : 'sent') : undefined,
            ts: m.ts,
          });
        }
      }

      if (fresh.length) setItems((p) => [...p, ...fresh]);
    };
    const t = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [selected, selectedId, isAgentView, viewAs]);

  // Call polling — runs whenever the console is open (not agent-view). 1s tick
  // during an active call; 4s when idle so incoming invites surface quickly.
  useEffect(() => {
    if (isAgentView) return;
    let live = true;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const res = await api.consolePoll().catch(() => null);
      if (!live || !res) return;
      if (callActive) {
        for (const f of res.frames)
          if (f.kind === 'frame')
            setCallTranscript((p) => [...p, { from: f.from, body: String(f.body ?? ''), attachments: f.attachments }]);
        if (res.ended) {
          setCallActive(false);
          setCallTranscript((p) => [...p, { from: 'system', body: 'call ended' }]);
        }
      } else {
        const invite = res.frames.find((f) => f.kind === 'invite');
        if (invite) setCallIncoming({ callId: invite.id, from: invite.from });
      }
    };
    const t = setInterval(tick, callActive ? 1000 : 4000);
    return () => { live = false; clearInterval(t); };
  }, [callActive, isAgentView]);

  // Opening a thread: `peer` is the display @handle, `id` the authoritative peer
  // agent_id from the thread list. History loads by `id` when we have it — the
  // handle can fail to resolve back (a deleted connector or an unexposed peer
  // isn't bound), whereas the id is exactly what the thread was grouped under.
  const openThread = (peer: string, id?: string | null) => {
    setSelected(peer || null);
    setSelectedId(id ?? null);
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
        setItems((p) => [
          ...p,
          {
            kind: 'message',
            id: uid(),
            from: 'system',
            body: `couldn't attach ${f.name}: ${e instanceof Error ? e.message : e}`,
            mine: false,
            ts: Date.now(),
          },
        ]);
      }
    }
    const msgId = uid();
    setItems((p) => [
      ...p,
      {
        kind: 'message',
        id: msgId,
        from: 'you',
        body,
        mine: true,
        attachments: staged.length ? staged : undefined,
        status: 'sent',
        ts: Date.now(),
      },
    ]);
    const res = await api.consoleSms(selected, body, staged.length ? staged : undefined);
    if (res.error) {
      setItems((p) => [
        ...p,
        {
          kind: 'message',
          id: uid(),
          from: 'system',
          body: `couldn't send: ${res.error}`,
          mine: false,
          ts: Date.now(),
        },
      ]);
    }
  };

  const placeCall = async () => {
    if (!selected) return;
    setCallTranscript([]);
    setCallTarget(selected);
    const res = await api.consoleCall(selected);
    if (res.call_id) setCallActive(true);
  };
  const answerCall = async () => {
    if (!callIncoming) return;
    await api.consolePickup(callIncoming.callId, callIncoming.from);
    const fromNick = nickOf(callIncoming.from);
    setCallTranscript([{ from: 'system', body: `on a call with ${fromNick}` }]);
    setCallTarget(fromNick);
    setCallIncoming(null);
    setCallActive(true);
  };
  const speak = async () => {
    const text = callSay.trim();
    if (!text && callFiles.length === 0) return;
    setCallSay('');
    const pending = callFiles;
    setCallFiles([]);
    const staged: Attachment[] = [];
    for (const f of pending) {
      try { staged.push(await api.uploadConsoleFile(f, callTarget ?? '')); }
      catch { /* skip */ }
    }
    setCallTranscript((p) => [...p, { from: 'you', body: text, attachments: staged.length ? staged : undefined }]);
    await api.consoleSay(text, staged.length ? staged : undefined);
  };
  const hangup = async () => {
    await api.consoleHangup();
    setCallActive(false);
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
            <span className="thread-list-title">Conversations</span>
            {!isAgentView && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setComposing((c) => !c)}>
                {composing ? 'Cancel' : '+ New'}
              </button>
            )}
          </div>

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
          {threadsLoading && !dashboard ? (
            <SkeletonList count={3} className="thread-empty" />
          ) : threadsError && !dashboard ? (
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
                    <span className="thread-row-meta">
                      <span className="thread-ts">{fmtWhen(t.last_ms ?? t.last_ts)}</span>
                      {t.unread > 0 && <span className="thread-unread">{t.unread}</span>}
                    </span>
                  </span>
                  <span className="thread-last">
                    {t.last_call
                      ? fmtCallPreview(t.last_call)
                      : t.last_body || (t.has_attach ? '📎 attachment' : '…')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="thread-panel">
          {/* Incoming-call banner — floats above everything, regardless of open thread */}
          {callIncoming && !callActive && !isAgentView && (
            <div className="call-banner">
              <span>📞 Incoming call from <strong>{nickOf(callIncoming.from)}</strong></span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void answerCall()}>Answer</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCallIncoming(null)}>Ignore</button>
            </div>
          )}
          {!selected ? (
            <EmptyState
              icon="message"
              title="Select a conversation"
              description="Pick a conversation from the sidebar or start a new one to begin messaging."
              className="thread-placeholder"
            />
          ) : (
            <>
              <div className="thread-panel-head">
                <span className="thread-peer">
                  <PresenceDot state={presenceOf(selected)} /> {selected}
                </span>
                {isAgentView ? (
                  <span className="readonly-badge">Read-only · {selfLabel}'s inbox</span>
                ) : callActive && callTarget === selected ? (
                  <span className="call-active-badge">
                    <span className="call-live-dot" aria-hidden>●</span> On call
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void hangup()}>Hang up</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm call-btn"
                    title={`Call ${selected}`}
                    disabled={callActive}
                    onClick={() => void placeCall()}
                  >
                    📞
                  </button>
                )}
              </div>
              <div className="chat-thread" aria-label="Conversation" ref={threadRef} onScroll={onThreadScroll}>
                {items.length === 0 && !(callActive && callTarget === selected) ? (
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
                  items.map((item) =>
                    item.kind === 'message' ? (
                      <div key={item.id} className={`chat-line${item.mine ? ' mine' : ''}`}>
                        <span className="chat-from">{item.mine ? selfLabel : item.from}</span>
                        <span className="chat-body">
                          {item.body}
                          {item.attachments && item.attachments.length > 0 && <AttachmentLinks items={item.attachments} />}
                          <span className="msg-meta">
                            <span className="msg-time">{fmtMsgTime(item.ts)}</span>
                            {item.mine && item.status && <MsgTick status={item.status} />}
                          </span>
                        </span>
                      </div>
                    ) : (
                      <CallBlock
                        key={item.id}
                        call={item}
                        selfLabel={selfLabel}
                        peerId={peerIdRef.current}
                        nickOf={nickOf}
                      />
                    ),
                  )
                )}
                {/* Active call transcript — inline after history */}
                {callActive && callTarget === selected && (
                  <>
                    <div className="call-inline-divider"><span>📞 Call in progress</span></div>
                    {callTranscript.map((l, i) => (
                      <div key={`cf-${i}`} className={`chat-line${l.from === 'you' ? ' mine' : ''}`}>
                        <span className="chat-from">{l.from === 'you' ? selfLabel : nickOf(l.from)}</span>
                        <span className="chat-body">
                          {l.body}
                          {l.attachments && l.attachments.length > 0 && <AttachmentLinks items={l.attachments} />}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
              {hasNew && (
                <button type="button" className="jump-latest" onClick={scrollToBottom}>
                  ↓ New messages
                </button>
              )}
              {isAgentView ? (
                <p className="readonly-note">You're viewing {selfLabel}'s inbox. Switch to "You" to send or call.</p>
              ) : callActive && callTarget === selected ? (
                <>
                  <PendingFiles files={callFiles} setFiles={setCallFiles} />
                  <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); void speak(); }}>
                    <AttachControl setFiles={setCallFiles} disabled={false} />
                    <input className="input" value={callSay} placeholder="Say something…" onChange={(e) => setCallSay(e.target.value)} aria-label="Say on the call" />
                    <button type="submit" className="btn btn-inverse" disabled={!callSay.trim() && callFiles.length === 0}>Say</button>
                  </form>
                </>
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
