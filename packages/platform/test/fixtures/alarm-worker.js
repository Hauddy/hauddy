// Test-only entry point. Never included in the production Worker configuration.
import { HubDO } from '../../src/hub-do.ts';
import { scheduleAlarmBy } from '../../src/alarms.ts';

export class AlarmTestHub extends HubDO {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/seed') {
      const now = Date.now();
      const scenario = url.searchParams.get('case');
      await this.env.WAITLIST_DB.prepare('CREATE TABLE IF NOT EXISTS waitlist(email TEXT PRIMARY KEY, created_at TEXT, source TEXT)').run();
      if (scenario === 'mirror') {
        for (let i = 0; i < 101; i++) this.db.sql.exec(
          'INSERT INTO waitlist_members(email,created_at,source,mirrored) VALUES(?,?,?,0)',
          `alarm-${i}@example.test`, new Date(now).toISOString(), 'landing');
      }
      if (scenario !== 'idle') {
        const result = await this.files.put(new Uint8Array([1]).buffer,
          { name: 'fixture', mime: 'text/plain', owner: 'fixture', to: null, account_id: null }, now);
        if (!result.ok) throw new Error(result.error);
        await this.ctx.storage.put('expiry', result.file.expires_ms);
        this.db.sql.exec('INSERT INTO email_tokens(hash,purpose,email,expires_ms) VALUES(?,?,?,?)',
          'future-token', 'reset', 'fixture@example.test', now + 7_200_000);
      }
      // Real scheduled execution, so getAlarm() semantics inside alarm() are tested.
      await scheduleAlarmBy(this.ctx.storage, now + 200);
      return Response.json({ now });
    }
    if (url.pathname === '/concurrent') {
      const now = Date.now();
      const deadlines = [90_000, 120_000, 30_000, 60_000, 180_000].map(ms => now + ms);
      await Promise.all(deadlines.map(at => scheduleAlarmBy(this.ctx.storage, at)));
      return Response.json({ expected: Math.min(...deadlines), actual: await this.ctx.storage.getAlarm() });
    }
    if (url.pathname === '/state') {
      return Response.json({
        run: await this.ctx.storage.get('run'),
        next: await this.ctx.storage.getAlarm(),
        pending: this.db.sql.exec('SELECT COUNT(*) AS n FROM waitlist_members WHERE mirrored=0').toArray()[0].n,
        mirrored: (await this.env.WAITLIST_DB.prepare('SELECT COUNT(*) AS n FROM waitlist').first()).n,
      });
    }
    return new Response('test route not found', { status: 404 });
  }
  async alarm() {
    const entryAlarm = await this.ctx.storage.getAlarm();
    await super.alarm();
    const prior = await this.ctx.storage.get('run');
    await this.ctx.storage.put('run', { count: (prior?.count ?? 0) + 1, entryAlarm, completed: Date.now() });
  }
}

export default {
  fetch(request, env) {
    const name = new URL(request.url).searchParams.get('case') ?? 'mirror';
    return env.HUB.get(env.HUB.idFromName(name)).fetch(request);
  },
};
