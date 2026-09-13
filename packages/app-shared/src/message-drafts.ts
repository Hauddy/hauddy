import { useState, type SetStateAction } from 'react';

interface Draft {
  body: string;
  files: File[];
}
interface DraftState {
  aliases: Record<string, string>;
  drafts: Record<string, Draft>;
}
const emptyDraft: Draft = { body: '', files: [] };
const handleKey = (sender: string | null, peer: string) => JSON.stringify([sender, 'handle', peer.trim().toLowerCase()]);
const idKey = (sender: string | null, id: string) => JSON.stringify([sender, 'id', id]);

/** Screen-local drafts: never persist message bodies or File objects to storage. */
export function useConversationDraft(sender: string | null, peer: string | null, peerId: string | null) {
  const [state, setState] = useState<DraftState>({ aliases: {}, drafts: {} });
  const alias = peer === null ? null : handleKey(sender, peer);
  const recipientId = peerId ?? (alias ? state.aliases[alias] : null);
  const key = recipientId ? idKey(sender, recipientId) : alias;
  const draft = key ? state.drafts[key] ?? emptyDraft : emptyDraft;

  const update = (change: (previous: Draft) => Draft) => {
    if (!key) return;
    setState((previous) => {
      // Resolve again inside the update, in case history resolved the handle
      // in the same batch as this input event.
      const target = previous.aliases[key] ? idKey(sender, previous.aliases[key]) : key;
      const next = change(previous.drafts[target] ?? emptyDraft);
      const drafts = { ...previous.drafts };
      if (!next.body && !next.files.length) delete drafts[target];
      else drafts[target] = next;
      return { ...previous, drafts };
    });
  };

  const resolveRecipient = (handle: string, id: string) => {
    const source = handleKey(sender, handle);
    const target = idKey(sender, id);
    setState((previous) => {
      if (previous.aliases[source] === id && !previous.drafts[source]) return previous;
      const drafts = { ...previous.drafts };
      const pending = drafts[source];
      if (pending) {
        const existing = drafts[target];
        // A newly discovered alias can have edits before it resolves. Keep
        // those as well as any earlier draft for the same canonical peer.
        drafts[target] = existing ? {
          body: existing.body === pending.body ? existing.body : [existing.body, pending.body].filter(Boolean).join('\n'),
          files: [...new Set([...existing.files, ...pending.files])],
        } : pending;
        delete drafts[source];
      }
      return { aliases: { ...previous.aliases, [source]: id }, drafts };
    });
  };

  return {
    ...draft,
    recipientId,
    setBody: (body: string) => update((previous) => ({ ...previous, body })),
    setFiles: (files: SetStateAction<File[]>) => update((previous) => ({
      ...previous, files: typeof files === 'function' ? files(previous.files) : files,
    })),
    clear: () => update(() => emptyDraft),
    resolveRecipient,
  };
}
