import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clearKey, useApiState } from '../api';
import ErrorState from '../components/ErrorState';
import { SkeletonCard } from '../components/LoadingSkeleton';

/** Account settings: profile (username == your @handle + bio), password, and the
 *  friend auto-accept toggle (rehomed here from the Friends screen). Distinct from
 *  the Account screen, which is about the API key + app download. */
export default function Settings() {
  const { data: profile, loading, error, refetch } = useApiState(async () => {
    const [session, identity] = await Promise.all([api.getSession(), api.getIdentity()]);
    return { session, identity };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">{profile?.session.email ?? 'Manage your profile and account preferences.'}</p>
        </div>
      </div>

      {error && <ErrorState title={profile ? 'Could not refresh your profile' : 'Could not load your profile'} error={error} onRetry={refetch} />}
      {!profile && loading && <div className="settings-section" role="status" aria-label="Loading profile"><SkeletonCard /></div>}
      {profile && <ProfileSection currentName={profile.session.name} currentBio={profile.identity.bio} handle={profile.identity.handle} />}
      <PasswordSection />
      <FriendsSection />
      <DangerSection />
    </>
  );
}

function DangerSection() {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAccount();
      clearKey();
      navigate('/account');
    } catch (err: unknown) {
      setDeleting(false);
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    }
  };

  return (
    <section className="settings-section settings-danger">
      <h2 className="section-title bad">Danger Zone</h2>
      <p className="book-explainer">
        Deleting your account permanently removes your platform account, its stored history and files, handle reservations, connectors, and friendships. You lose access to this account and its handles. History on your computer and private copies held by other participants remain. This action cannot be undone.
      </p>

      {!confirming ? (
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
          Delete account…
        </button>
      ) : (
        <div className="danger-confirm-box">
          <p className="danger-warning">
            Delete your platform account, its stored history and files, handles, connectors, and friendships? History on your computer and other participants’ private copies will remain.
          </p>
          <div className="danger-actions">
            <button
              type="button"
              className="btn btn-danger"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? 'Deleting account…' : 'Yes, delete my account'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={deleting}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="notice bad" style={{ marginTop: 12 }} aria-live="polite">
          {error}
        </div>
      )}
    </section>
  );
}

type Note = { ok: boolean; text: string } | null;

function ProfileSection({
  currentName,
  currentBio,
  handle,
}: {
  currentName?: string;
  currentBio?: string;
  handle: string | null;
}) {
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [nameDirty, setNameDirty] = useState(false);
  const [bioDirty, setBioDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<Note>(null);

  // Seed each field from the loaded values until the user starts editing it.
  useEffect(() => {
    if (!nameDirty && currentName !== undefined) setName(currentName);
  }, [currentName, nameDirty]);
  useEffect(() => {
    if (!bioDirty && currentBio !== undefined) setBio(currentBio);
  }, [currentBio, bioDirty]);

  const trimmedName = name.trim();
  const nameChanged = trimmedName !== (currentName ?? '');
  const bioChanged = bio !== (currentBio ?? '');
  const nothingToSave = !nameChanged && !bioChanged;
  // Live handle preview (the server slugifies the same lowercased input).
  const previewHandle = trimmedName ? `@${trimmedName.toLowerCase()}` : handle ?? '@…';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || nothingToSave || !trimmedName) return;
    setSaving(true);
    const patch: { username?: string; bio?: string } = {};
    if (nameChanged) patch.username = trimmedName;
    if (bioChanged) patch.bio = bio;
    const r = await api.updateProfile(patch);
    setSaving(false);
    if (r.ok) {
      setNote({ ok: true, text: 'Saved.' });
      setNameDirty(false);
      setBioDirty(false);
    } else {
      setNote({ ok: false, text: r.error });
    }
  };

  return (
    <section className="settings-section">
      <h2 className="section-title">Profile</h2>
      <p className="book-explainer">
        Your <strong>username</strong> is your <code>@handle</code> on the network — how other people
        and agents reach you — and one of the ways you sign in. 3–32 characters: letters, numbers,{' '}
        <code>_</code> or <code>-</code>.
      </p>
      <form className="settings-form" onSubmit={save}>
        <label className="settings-field">
          <span className="settings-label">Username / handle</span>
          <input
            className="input"
            value={name}
            placeholder="username"
            autoComplete="username"
            onChange={(e) => {
              setName(e.target.value);
              setNameDirty(true);
              setNote(null);
            }}
          />
          <span className="settings-hint">
            Your handle: <code>{previewHandle}</code>
          </span>
        </label>
        <label className="settings-field settings-field-wide">
          <span className="settings-label">Bio</span>
          <textarea
            className="input settings-textarea"
            value={bio}
            rows={3}
            placeholder="your human owner"
            onChange={(e) => {
              setBio(e.target.value);
              setBioDirty(true);
              setNote(null);
            }}
          />
          <span className="settings-hint">
            Shown to people you connect with, and to your own agents when you message them (they see
            “your human owner” if this is empty).
          </span>
        </label>
        <button type="submit" className="btn btn-primary" disabled={saving || nothingToSave || !trimmedName}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
      {note && (
        <div className={`notice ${note.ok ? 'ok' : 'bad'}`} aria-live="polite">
          {note.text}
        </div>
      )}
    </section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const tooShort = next.length > 0 && next.length < 6;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= 6 && next === confirm && !saving;

  const clear = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
  };
  const onChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setNote(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    const r = await api.changePassword(current, next);
    setSaving(false);
    if (r.ok) {
      setNote({ ok: true, text: 'Password changed.' });
      clear();
    } else {
      setNote({ ok: false, text: r.error });
    }
  };

  return (
    <section className="settings-section">
      <h2 className="section-title">Password</h2>
      <form className="settings-form" onSubmit={save}>
        <label className="settings-field">
          <span className="settings-label">Current password</span>
          <input
            className="input"
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={onChange(setCurrent)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">New password</span>
          <input
            className="input"
            type="password"
            value={next}
            autoComplete="new-password"
            onChange={onChange(setNext)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Confirm new password</span>
          <input
            className="input"
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={onChange(setConfirm)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {saving ? 'Saving…' : 'Change password'}
        </button>
      </form>
      {tooShort && <div className="settings-hint">New password must be at least 6 characters.</div>}
      {mismatch && <div className="settings-hint bad">Passwords don’t match.</div>}
      {note && (
        <div className={`notice ${note.ok ? 'ok' : 'bad'}`} aria-live="polite">
          {note.text}
        </div>
      )}
    </section>
  );
}

function FriendsSection() {
  // Ignore reads started before/during a save: only a subsequent read can
  // reconcile its result. This also protects against a delayed polling response.
  const revision = useRef(0);
  const saving = useRef(false);
  const { data, error: loadError, refetch } = useApiState(async () => {
    const started = revision.current;
    const friends = await api.listFriends();
    return { value: friends.auto_accept, revision: started };
  });
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ value: boolean; error: string } | null>(null);

  useEffect(() => {
    if (!data || saving.current || data.revision !== revision.current) return;
    setConfirmed(data.value);
    setOn(data.value);
    setFailure((previous) => previous?.value === data.value ? null : previous);
  }, [data]);

  useEffect(() => {
    window.addEventListener('online', refetch);
    return () => window.removeEventListener('online', refetch);
  }, [refetch]);

  const toggle = async (v: boolean) => {
    if (saving.current || confirmed === null) return;
    saving.current = true;
    revision.current += 1;
    setPending(true);
    setFailure(null);
    setOn(v);
    try {
      const result = await api.setAutoAccept(v);
      if (typeof result.auto_accept !== 'boolean') throw new Error('The server did not confirm the setting.');
      setConfirmed(result.auto_accept);
      setOn(result.auto_accept);
    } catch (err) {
      setOn(confirmed);
      setFailure({ value: v, error: err instanceof Error ? err.message : 'Unable to save the setting.' });
    } finally {
      revision.current += 1;
      saving.current = false;
      setPending(false);
      refetch();
    }
  };

  return (
    <section className="settings-section">
      <h2 className="section-title">Friends</h2>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={on}
          disabled={confirmed === null || pending}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span className="settings-toggle-text">
          <strong>Auto-accept friend requests</strong>
          <span className="settings-toggle-sub">
            Automatically link with anyone who sends you a request. Off by default — you review each one on
            the Friends screen.
          </span>
        </span>
      </label>
      {pending && <p role="status">Saving auto-accept…</p>}
      {failure && (
        <>
          <p className="settings-hint">Showing the last confirmed setting.</p>
          <ErrorState title="Auto-accept could not be saved" error={failure.error} onRetry={() => void toggle(failure.value)} compact />
        </>
      )}
      {!failure && loadError && <ErrorState title="Unable to refresh auto-accept" error={loadError} onRetry={refetch} compact />}
    </section>
  );
}
