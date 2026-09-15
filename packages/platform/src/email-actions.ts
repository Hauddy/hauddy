import { ACQUISITION_EVENTS, acquisitionSource, normalizeNickname } from '@hauddy/protocol';
import { hashPassword, randomHex } from './crypto.js';
import type { Db } from './db.js';
import type { Env } from './env.js';

const DAY = 86_400_000;
export class EmailActionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function tokenHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}
type Token = { hash: string; purpose: string; email: string; account_id: string | null; credential: string | null; expires_ms: number };
type Hold = { email: string; nickname: string; status: string; hold_expires_ms: number; source: string };
/** All ownership transitions happen synchronously in the platform's one SQL authority. */
export class EmailActions {
  constructor(private db: Db, private env: Env, private atomic: <T>(fn: () => T) => T) {}
  private row<T>(query: string, ...args: (string | number | null)[]): T | undefined { return this.db.sql.exec(query, ...args).toArray()[0] as T | undefined; }
  purge() {
    this.db.sql.exec("DELETE FROM email_tokens WHERE purpose!='reset' AND email IN (SELECT email FROM preregistrations WHERE hold_expires_ms<=?)", Date.now());
    this.db.sql.exec('DELETE FROM email_tokens WHERE expires_ms <= ?', Date.now());
    this.db.sql.exec('DELETE FROM rate_limits WHERE reset_ms<=?', Date.now());
    this.db.sql.exec('DELETE FROM preregistrations WHERE hold_expires_ms <= ?', Date.now());
  }
  private source(raw: unknown) { return acquisitionSource(raw, this.env.ACQUISITION_CAMPAIGNS); }
  event(event: string, rawSource: unknown) {
    if (!(ACQUISITION_EVENTS as readonly string[]).includes(event)) throw new EmailActionError(400, 'Unknown acquisition event.');
    const source = this.source(rawSource);
    this.db.sql.exec('INSERT INTO acquisition_events(source,event,count) VALUES(?,?,1) ON CONFLICT(source,event) DO UPDATE SET count=count+1', source, event);
  }
  private async rate(email: string, purpose: string) {
    if (this.env.RATE_LIMIT !== 'off' && this.db.rateLimited(`email:${purpose}:${await tokenHash(email)}`, 3, 15 * 60_000, Date.now())) throw new EmailActionError(429, 'Please wait 15 minutes before requesting another email.');
  }
  private email(raw: unknown) {
    if (typeof raw !== 'string' || raw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())) throw new EmailActionError(400, 'Enter a valid email address.');
    return raw.trim().toLowerCase();
  }
  private async newToken(purpose: string, email: string, duration: number, accountId: string | null = null, credential: string | null = null) {
    const token = randomHex(32), hash = await tokenHash(token);
    return { token, record: { hash, purpose, email, account_id: accountId, credential, expires_ms: Date.now() + duration } };
  }
  private storeToken(t: Token) {
    this.db.sql.exec('INSERT INTO email_tokens(hash,purpose,email,account_id,credential,expires_ms) VALUES(?,?,?,?,?,?)', t.hash, t.purpose, t.email, t.account_id, t.credential, t.expires_ms);
  }
  private token(hash: string, purpose: string): Token {
    const t = this.row<Token>('SELECT * FROM email_tokens WHERE hash=? AND purpose=? AND expires_ms>?', hash, purpose, Date.now());
    if (!t) throw new EmailActionError(410, 'This link has expired or was already used. Request a new email.');
    return t;
  }
  private digest(raw: unknown) {
    if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) throw new EmailActionError(410, 'This link is invalid or expired. Request a new email.');
    return tokenHash(raw);
  }
  hasExpiringData() {
    return !!this.row('SELECT 1 FROM email_tokens LIMIT 1') || !!this.row('SELECT 1 FROM preregistrations LIMIT 1') || !!this.row('SELECT 1 FROM rate_limits LIMIT 1');
  }
  private async mail(email: string, subject: string, text: string) {
    if (!this.env.RESEND_API_KEY) throw new EmailActionError(503, 'Email delivery is unavailable. Please retry later.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: 'Hauddy <hello@hauddy.com>', to: [email], subject, text }), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new EmailActionError(503, 'Email could not be delivered. Please retry.');
  }
  async requestReset(rawEmail: unknown) {
    const email = this.email(rawEmail); await this.rate(email, 'reset'); this.purge();
    // A neutral response also covers unknown accounts and delivery failures.
    const account = this.db.accountByEmail(email);
    if (!account) return { ok: true };
    const { token, record } = await this.newToken('reset', email, 30 * 60_000, account.account_id, account.pw_hash);
    this.storeToken(record);
    try { await this.mail(email, 'Reset your Hauddy password', `Use this single-use link within 30 minutes:\nhttps://app.hauddy.com/reset-password#token=${token}\n\nIf you did not request this, ignore this email. Your password has not changed.`); }
    catch { this.db.sql.exec('DELETE FROM email_tokens WHERE hash=?', record.hash); }
    return { ok: true };
  }
  async reset(rawToken: unknown, password: unknown) {
    if (typeof password !== 'string' || password.length < 6 || password.length > 1024) throw new EmailActionError(400, 'Use a password between 6 and 1024 characters.');
    const hash = await this.digest(rawToken);
    this.token(hash, 'reset');
    const passwordHash = await hashPassword(password);
    return this.atomic(() => {
      const t = this.token(hash, 'reset'), account = t.account_id ? this.db.getAccount(t.account_id) : null;
      if (!account || account.pw_hash !== t.credential) throw new EmailActionError(410, 'This reset link is no longer valid. Request a new email.');
      this.db.sql.exec('UPDATE accounts SET pw_hash=?,pw_salt=?,pw_iter=? WHERE account_id=?', passwordHash.hash, passwordHash.salt, passwordHash.iterations, account.account_id);
      this.db.rotateKey(account.account_id);
      this.db.sql.exec("DELETE FROM email_tokens WHERE email=? AND purpose='reset'", t.email);
      return { ok: true, account_id: account.account_id };
    });
  }
  async requestReservation(rawEmail: unknown, rawHandle: unknown, rawSource: unknown) {
    const email = this.email(rawEmail), nickname = normalizeNickname(String(rawHandle ?? ''));
    if (!nickname) throw new EmailActionError(400, 'Choose a handle with 2–24 letters, numbers, underscores or hyphens.');
    if (!this.env.RESEND_API_KEY) throw new EmailActionError(503, 'Email delivery is unavailable. Please retry later.');
    await this.rate(email, 'reservation'); this.purge();
    const { token, record } = await this.newToken('verify', email, DAY, null, nickname);
    const cancellation = await this.newToken('pending-cancel', email, DAY, null, nickname);
    const send = this.atomic(() => {
      // Read inside the transaction so concurrent first requests share one source.
      const first = this.row<{ source: string }>('SELECT source FROM waitlist_members WHERE email=?', email);
      const source = this.source(first?.source ?? rawSource ?? 'landing');
      const other = this.row<Hold>('SELECT * FROM preregistrations WHERE nickname=?', nickname);
      const own = this.row<Hold>('SELECT * FROM preregistrations WHERE email=?', email);
      // Do not reveal which email owns an already held handle, or which other
      // handle an address holds. Only that mailbox receives management links.
      if ((other && other.email !== email) || (own && own.nickname !== nickname)) return false;
      if (!own && !this.db.nicknameAvailability(nickname).available) throw new EmailActionError(409, 'That handle is unavailable. Choose another; your email can stay the same.');
      if (!own) {
        this.db.sql.exec('INSERT INTO preregistrations(email,nickname,status,hold_expires_ms,source) VALUES(?,?,?,?,?)', email, nickname, 'pending', Date.now() + DAY, source);
        this.storeToken(cancellation.record);
      }
      this.db.sql.exec('INSERT INTO waitlist_members(email,created_at,source,mirrored) VALUES(?,?,?,0) ON CONFLICT(email) DO NOTHING', email, new Date().toISOString(), source);
      this.storeToken(record);
      this.event('request', source);
      return true;
    });
    if (send) {
      try { await this.mail(email, 'Confirm your Hauddy handle reservation', `Hauddy connects AI agents across tools with messaging, files and live calls. Local use needs no account; network access is by invitation.\n\nConfirm @${nickname} with this single-use link within 24 hours:\nhttps://hauddy.com/reservation#token=${token}\n\nThis reserves an agent handle and joins the waitlist; it does not activate an account. Unconfirmed holds expire after 24 hours. Confirmed holds last up to 180 days while waiting, with 30 days to claim after invitation. To correct this address, submit again with your correct email after the pending hold expires. If you did not request this, ignore it.`); }
      catch (error) {
        this.atomic(() => {
          this.db.sql.exec('DELETE FROM email_tokens WHERE hash=?', record.hash);
          if (this.row('SELECT 1 FROM email_tokens WHERE hash=?', cancellation.record.hash) && !this.row("SELECT 1 FROM email_tokens WHERE email=? AND purpose='verify'", email)) {
            this.db.sql.exec("DELETE FROM preregistrations WHERE email=? AND status='pending'", email);
            this.db.sql.exec('DELETE FROM email_tokens WHERE hash=?', cancellation.record.hash);
          }
        });
        throw error;
      }
    }
    return { ok: true, pending: true, request_token: cancellation.token };
  }
  async verify(rawToken: unknown) {
    const hash = await this.digest(rawToken);
    const t = this.token(hash, 'verify');
    const cancel = await this.newToken('cancel', t.email, DAY, null, t.credential);
    const result = this.atomic(() => {
      this.token(hash, 'verify'); this.purge();
      const hold = this.row<Hold>('SELECT * FROM preregistrations WHERE email=?', t.email);
      if (!hold || hold.nickname !== t.credential) throw new EmailActionError(410, 'The hold has expired or changed. Request a new reservation.');
      if (hold.status === 'pending') {
        this.db.sql.exec("UPDATE preregistrations SET status='verified',hold_expires_ms=? WHERE email=?", Date.now() + 180 * DAY, t.email);
        this.event('verified_reservation', hold.source);
      }
      this.db.sql.exec('DELETE FROM email_tokens WHERE hash=?', hash);
      this.storeToken(cancel.record);
      this.event('verification', hold.source);
      return { ok: true, handle: `@${hold.nickname}`, cancel_token: cancel.token, invited: this.db.isInvited(t.email) };
    });
    if (result.invited) {
      try { await this.invite(t.email); }
      catch { return { ...result, invitation_email_pending: true }; }
    }
    return result;
  }
  async invite(rawEmail: unknown) {
    const email = this.email(rawEmail); this.purge();
    const hold = this.row<Hold>("SELECT * FROM preregistrations WHERE email=? AND status IN ('verified','invited')", email);
    if (!hold || !this.db.isInvited(email)) return;
    const deadline = hold.status === 'invited' ? hold.hold_expires_ms : Date.now() + 30 * DAY;
    const { token, record } = await this.newToken('claim', email, deadline - Date.now(), null, hold.nickname);
    const currentDeadline = this.atomic(() => {
      const current = this.row<Hold>("SELECT * FROM preregistrations WHERE email=? AND status IN ('verified','invited') AND hold_expires_ms>?", email, Date.now());
      if (!current || current.nickname !== hold.nickname || !this.db.isInvited(email)) throw new EmailActionError(410, 'This reservation has expired or changed.');
      const expires = current.status === 'invited' ? current.hold_expires_ms : deadline;
      this.db.sql.exec("UPDATE preregistrations SET status='invited',hold_expires_ms=? WHERE email=?", expires, email);
      this.storeToken({ ...record, expires_ms: expires });
      if (current.status !== 'invited') this.event('invitation', current.source);
      return expires;
    });
    await this.mail(email, 'Your Hauddy invitation is ready', `Hauddy connects AI agents across tools with messaging, files and live calls. Your network invitation is ready.\n\nYour agent handle @${hold.nickname} is held until ${new Date(currentDeadline).toISOString().slice(0, 10)}. Create an account or sign in, then claim it:\nhttps://app.hauddy.com/claim-handle#token=${token}\n\nChoose your own personal username. The reserved handle will be ready to attach to an agent, not used as your personal username.`);
  }
  async cancel(rawToken: unknown) {
    const hash = await this.digest(rawToken);
    return this.atomic(() => {
      let t: Token;
      this.purge();
      try { t = this.token(hash, 'cancel'); }
      catch {
        t = this.token(hash, 'pending-cancel');
        const hold = this.row<Hold>("SELECT * FROM preregistrations WHERE email=? AND status='pending' AND nickname=?", t.email, t.credential);
        if (!hold) throw new EmailActionError(410, 'This pending hold can no longer be cancelled. Use the verified email link.');
      }
      this.db.sql.exec('DELETE FROM preregistrations WHERE email=?', t.email);
      this.db.sql.exec("DELETE FROM email_tokens WHERE email=? AND purpose!='reset'", t.email);
      return { ok: true };
    });
  }
  async claim(rawToken: unknown, accountId: string) {
    const hash = await this.digest(rawToken);
    return this.atomic(() => {
      const t = this.token(hash, 'claim'), account = this.db.getAccount(accountId);
      if (!account || account.email.toLowerCase() !== t.email || !this.db.isInvited(t.email)) throw new EmailActionError(403, 'Sign in with the invited email address to claim this handle.');
      const hold = this.row<Hold>("SELECT * FROM preregistrations WHERE email=? AND status='invited' AND hold_expires_ms>?", t.email, Date.now());
      if (!hold || hold.nickname !== t.credential) throw new EmailActionError(410, 'This reservation has expired or was already claimed.');
      this.db.sql.exec('DELETE FROM preregistrations WHERE email=?', t.email);
      const result = this.db.reserveNickname(accountId, hold.nickname);
      if (!result.ok) throw new EmailActionError(409, 'The handle cannot be transferred yet. Release an unused account reservation and retry.');
      this.db.sql.exec("DELETE FROM email_tokens WHERE email=? AND purpose!='reset'", t.email);
      this.event('claim', hold.source);
      return { ok: true, handle: `@${hold.nickname}` };
    });
  }
  async mirrorWaitlist() {
    if (!this.env.WAITLIST_DB) return false;
    const rows = this.db.sql.exec<{ email: string; created_at: string; source: string }>('SELECT email,created_at,source FROM waitlist_members WHERE mirrored=0 LIMIT 100').toArray();
    for (const row of rows) {
      await this.env.WAITLIST_DB.prepare('INSERT INTO waitlist(email,created_at,source) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING').bind(row.email, row.created_at, row.source).run();
      this.db.sql.exec('UPDATE waitlist_members SET mirrored=1 WHERE email=?', row.email);
    }
    return rows.length === 100;
  }
}
