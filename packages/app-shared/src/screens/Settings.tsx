import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clearKey, useApiData } from '../api';

/** Account settings: profile (username == your @handle + bio), password, and the
 *  friend auto-accept toggle (rehomed here from the Friends screen). Distinct from
 *  the Account screen, which is about the API key + app download. */
export default function Settings() {
  const session = useApiData(() => api.getSession());
  const identity = useApiData(() => api.getIdentity());
  const friends = useApiData(() => api.listFriends());

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">{session?.email ?? '…'}</p>
        </div>
      </div>

      <ProfileSection currentName={session?.name} currentBio={identity?.bio} handle={identity?.handle ?? null} />
      <PasswordSection />
      <FriendsSection autoAccept={friends?.auto_accept} loaded={friends !== undefined} />
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
        Deleting your account removes your handle reservations, connectors, and friendships permanently. This action cannot be undone.
      </p>

      {!confirming ? (
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
          Delete account…
        </button>
      ) : (
        <div className="danger-confirm-box">
          <p className="danger-warning">
            Are you sure you want to permanently delete your account and all associated data?
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

function FriendsSection({ autoAccept, loaded }: { autoAccept?: boolean; loaded: boolean }) {
  // Optimistic local mirror so the toggle feels instant; the server stays the
  // source of truth on the next refresh.
  const [on, setOn] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && autoAccept !== undefined) setOn(autoAccept);
  }, [autoAccept, touched]);

  const toggle = async (v: boolean) => {
    setTouched(true);
    setOn(v);
    await api.setAutoAccept(v);
  };

  return (
    <section className="settings-section">
      <h2 className="section-title">Friends</h2>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={on}
          disabled={!loaded}
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
    </section>
  );
}
