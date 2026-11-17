'use strict';
// Actual service, dependency mocked: never loads MySQL or nodemailer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const filename = path.resolve(__dirname, '../src/services/emailService.js');

function service(db, sendMail = async () => ({ messageId: 'mock-message' }), env = {}) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'process', fs.readFileSync(filename, 'utf8'))(
    id => {
      if (id === '../config/db') return db;
      if (id === 'nodemailer') return { createTransport() { throw Error('Real transport forbidden'); } };
      if (id === 'crypto') return require('node:crypto');
      if (id === './notificationDeliveryPolicy') return require('../src/services/notificationDeliveryPolicy');
      if (id === './recurringReminderPolicy') return require('../src/services/recurringReminderPolicy');
      throw Error('Unexpected dependency: ' + id);
    }, mod, mod.exports, { env: { NODE_ENV: 'test', APP_FRONTEND_URL: 'https://app.miljor.test', ...env } }
  );
  mod.exports.transporter = { sendMail };
  return mod.exports;
}

function memory() {
  const rows = [];
  const trace = [];
  const challenges = [];
  const preferences = new Map();
  let now = 1_000_000;
  const due = row => row.attempt_count < 3 && !['SUPERSEDED_BY_NEWER_REQUEST', 'OTP_CHALLENGE_INVALID'].includes(row.last_error) && (
    (row.status === 'QUEUED' && (row.next_attempt_at == null || row.next_attempt_at <= now)) ||
    (row.status === 'FAILED' && (row.next_attempt_at != null
      ? row.next_attempt_at <= now : row.last_attempted_at == null || row.last_attempted_at <= now - 300000)) ||
    (row.status === 'SENDING' && row.claim_expires_at <= now)
  );
  const db = { async query(sql, args = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    trace.push({ q, args });
    if (q.startsWith('INSERT INTO email_verifications')) {
      const [user_id,email,otp_hash,purpose] = args;
      const record = { id: challenges.length+1,user_id,email,otp_hash,purpose,created_at:now,
        expires_at:now+600000,consumed_at:null,attempts_count:0 };
      challenges.push(record);
      return [{ insertId:record.id,affectedRows:1 }];
    }
    if (q.startsWith('UPDATE email_verifications SET consumed_at')) {
      const matching = challenges.filter(r => q.includes('WHERE id = ?') ? r.id === args[0] :
        r.user_id === args[0] && r.purpose === args[1] && r.consumed_at == null);
      for (const record of matching) record.consumed_at = now;
      return [{ affectedRows:matching.length }];
    }
    if (q.includes("last_error = 'SUPERSEDED_BY_NEWER_REQUEST'")) {
      for (const row of rows) if (row.recipient_user_id === args[0] && row.template_name === args[1] &&
        ['QUEUED','FAILED'].includes(row.status)) Object.assign(row, {status:'FAILED',last_error:'SUPERSEDED_BY_NEWER_REQUEST',next_attempt_at:null});
      return [{ affectedRows:1 }];
    }
    if (q.includes('FROM notification_preferences')) {
      assert.doesNotMatch(q, /FOR UPDATE/);
      const preference = preferences.get(args[0]);
      return [preference ? [{ ...preference, db_now: new Date(now) }] : []];
    }
    if (q.includes('FROM email_verifications')) {
      assert.doesNotMatch(q, /FOR UPDATE/);
      assert.match(q, /ORDER BY id DESC LIMIT 1/);
      if (q.startsWith('SELECT created_at')) return [challenges.filter(r =>
        r.user_id === args[0] && r.purpose === args[1] && r.created_at > now-60000).slice(-1)];
      return [challenges.filter(r => r.user_id === args[0] && r.purpose === args[1])
        .sort((a,b) => b.id-a.id).slice(0,1).map(r => ({ ...r, is_expired: r.expires_at <= now ? 1 : 0 }))];
    }
    if (q.startsWith('INSERT INTO transactional_email_outbox')) {
      const [recipient_email, recipient_user_id, template_name, subject, payload_json, idempotency_key] = args;
      if (rows.some(r => r.idempotency_key === idempotency_key)) {
        const error = Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error;
      }
      const row = { id: rows.length + 1, recipient_email, recipient_user_id, template_name, subject,
        payload_json, idempotency_key, status: 'QUEUED', attempt_count: 0, next_attempt_at: null,
        last_attempted_at: null, claim_token: null, claim_expires_at: null };
      if (q.includes("'SENDING'")) Object.assign(row, { status: 'SENDING', attempt_count: 1,
        claim_token: args[6], claim_expires_at: now + 300000, last_attempted_at: now });
      rows.push(row);
      return [{ insertId: row.id, affectedRows: 1 }];
    }
    if (q.startsWith('SELECT') && q.includes('idempotency_key = ?')) {
      assert.match(q, /FOR UPDATE/);
      return [rows.filter(r => r.idempotency_key === args[0]).map(r => ({ ...r }))];
    }
    if (q.startsWith('SELECT') && q.includes('FROM transactional_email_outbox')) {
      assert.match(q, /COALESCE\(last_error, ''\) NOT IN \('SUPERSEDED_BY_NEWER_REQUEST', 'OTP_CHALLENGE_INVALID'\)/);
      return [rows.filter(due).slice(0, args[0]).map(r => ({ ...r }))];
    }
    if (q.includes("SET status = 'SENDING'")) {
      assert.match(q, /attempt_count < 3/);
      assert.match(q, /next_attempt_at <= NOW\(\)/);
      assert.match(q, /claim_expires_at <= NOW\(\)/);
      assert.match(q, /COALESCE\(last_error, ''\) NOT IN/);
      const row = rows.find(r => r.id === args[1]);
      if (!row || !due(row)) return [{ affectedRows: 0 }];
      Object.assign(row, { status: 'SENDING', claim_token: args[0], claim_expires_at: now + 300000,
        attempt_count: row.attempt_count + 1, last_attempted_at: now, next_attempt_at: null });
      return [{ affectedRows: 1 }];
    }
    if (q.includes('attempt_count >= 3')) {
      let affectedRows = 0;
      for (const row of rows) if (row.status === 'SENDING' && row.claim_expires_at <= now && row.attempt_count >= 3) {
        Object.assign(row, { status: 'FAILED', last_error: 'EMAIL_RETRY_LIMIT_REACHED', claim_token: null, claim_expires_at: null });
        affectedRows++;
      }
      return [{ affectedRows }];
    }
    if(q.includes("last_error='STALE_REMINDER_SUPPRESSED'")){
      const row=rows.find(r=>r.id===args[0]&&r.claim_token===args[1]&&r.status==='SENDING');
      if(!row)return [{affectedRows:0}];
      Object.assign(row,{status:'FAILED',attempt_count:3,last_error:'STALE_REMINDER_SUPPRESSED',claim_token:null,claim_expires_at:null,next_attempt_at:null});return [{affectedRows:1}];
    }
    const guarded = q.includes('claim_token = ?');
    if (guarded) {
      assert.match(q, /status = 'SENDING'/);
    }
    const id = guarded ? args[args.length - 2] : args[args.length - 1];
    const row = rows.find(r => r.id === id);
    if (!row || (guarded && (row.status !== 'SENDING' || row.claim_token !== args.at(-1) ||
        (q.includes('claim_expires_at > NOW()') && row.claim_expires_at <= now)))) {
      return [{ affectedRows: 0 }];
    }
    if (q.includes("SET status = 'QUEUED'")) {
      assert.match(q, /attempt_count = attempt_count - 1/);
      assert.match(q, /claim_expires_at > NOW\(\)/);
      Object.assign(row, { status: 'QUEUED', next_attempt_at: new Date(args[0]).getTime(),
        attempt_count: row.attempt_count - 1, claim_token: null, claim_expires_at: null });
    } else if (q.includes("SET status = 'PROVIDER_ACCEPTED'")) {
      Object.assign(row, { status: 'PROVIDER_ACCEPTED', provider_message_id: args[0], claim_token: null, claim_expires_at: null });
    } else if (q.includes("SET status = 'FAILED'")) {
      Object.assign(row, { status: 'FAILED', last_error: args[0], claim_token: null, claim_expires_at: null,
        next_attempt_at: q.includes('next_attempt_at = NULL') ? null :
          row.attempt_count < 3 ? now + 300000 * 2 ** (row.attempt_count - 1) : null });
      if (args[0] !== 'OTP_CHALLENGE_INVALID') assert.match(q, /POW\(2, attempt_count - 1\)/);
    } else throw Error('Unexpected SQL: ' + q);
    return [{ affectedRows: 1 }];
  } };
  return { db, rows, trace, challenges, preferences, advance(ms) { now += ms; }, setNow(value) { now = new Date(value).getTime(); } };
}
const input = changes => ({ recipientEmail: 'buyer@example.test', recipientUserId: 5,
  templateName: 'platform_notification', payload: { title: 'Update', message: 'Ready', locale: 'en' },
  idempotencyKey: 'notification-17', ...changes });
test('queued reminder is revalidated before transport and terminally suppressed when stale',async()=>{
 const f=memory();let sends=0;
 const db={query:async(sql,args)=>sql.includes('SELECT cy.id FROM procurement_recurring_contracts')?[[]]:f.db.query(sql,args)};
 db.getConnection=async()=>({query:db.query,beginTransaction:async()=>{},rollback:async()=>{},release(){}});
 const s=service(db,async()=>{sends++;return {messageId:'unexpected'};});
 await s.enqueueEmail(db,input({payload:{title:'Upcoming cutoff',message:'Review cycle',reminderContext:{contractId:12,cycleId:31}}}));
 const result=await s.processOutboxBatch();assert.equal(sends,0);assert.equal(result.failed,1);assert.equal(result.succeeded,0);
 assert.equal(f.rows[0].last_error,'STALE_REMINDER_SUPPRESSED');assert.equal(f.rows[0].attempt_count,3);
 assert.equal((await s.processOutboxBatch()).processed,0);
});
const forbiddenDb = { async query() { throw Error('Global DB access forbidden'); } };

test('enqueue uses caller connection only, renders first, deduplicates without dispatch', async () => {
  const f = memory(); let sends = 0;
  const s = service(forbiddenDb, async () => { sends++; });
  const first = await s.enqueueEmail(f.db, input());
  const replay = await s.enqueueEmail(f.db, input());
  assert.equal(first.outbox_id, 1);
  assert.equal(first.status, 'QUEUED');
  assert.equal(replay.outbox_id, first.outbox_id);
  assert.equal(f.rows.length, 1);
  assert.equal(sends, 0);
  assert.equal(f.rows[0].attempt_count, 0);
  f.rows[0].status = 'PROVIDER_ACCEPTED';
  assert.equal((await s.enqueueEmail(f.db, input())).status, 'PROVIDER_ACCEPTED');
  await assert.rejects(s.enqueueEmail(f.db, input({ payload: { title: 'Different', message: 'Ready' } })), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('absent key is stable across object key order and concurrent enqueue', async () => {
  const f = memory(); const s = service(forbiddenDb);
  const [a, b] = await Promise.all([
    s.enqueueEmail(f.db, input({ idempotencyKey: null })),
    s.enqueueEmail(f.db, input({ idempotencyKey: null, payload: { locale: 'en', message: 'Ready', title: 'Update' } }))
  ]);
  assert.equal(a.outbox_id, b.outbox_id);
  assert.equal(f.rows.length, 1);
});

test('reject invalid input before any SQL; database failures propagate', async () => {
  const f = memory(); const s = service(forbiddenDb);
  for (const change of [
    { recipientEmail: 'x@test\r\nBcc:a@test' }, { recipientEmail: {} }, { recipientEmail: 'a@b' },
    { recipientUserId: -1 }, { templateName: '' }, { payload: null },
    { payload: { title: '', message: 'Ready' } }, { payload: { title: 'Bad\r\nSubject', message: 'Ready' } },
    { payload: { title: 'Title', message: {} } }, { idempotencyKey: 'x'.repeat(101) }
  ]) await assert.rejects(s.enqueueEmail(f.db, input(change)), { statusCode: 400 });
  assert.equal(f.trace.length, 0);
  await assert.rejects(s.enqueueEmail(null, input()), { code: 'INVALID_CONNECTION' });
  const error = Error('connection lost');
  await assert.rejects(s.enqueueEmail({ query: async () => { throw error; } }, input()), e => e === error);
});

test('generic HTML escapes all text, Urdu RTL, no raw HTML, optional internal link', () => {
  const s = service(forbiddenDb);
  const rendered = s._renderTemplate('platform_notification', { title: '<b>اطلاع</b>',
    message: '<script>"&\'</script>\nNext', locale: 'ur-PK', deepLink: '/buyer/orders?x=1&y=2', html: '<img src=x onerror=alert(1)>' });
  assert.match(rendered.html, /lang="ur" dir="rtl"/);
  assert.match(rendered.html, /&lt;b&gt;/);
  assert.match(rendered.html, /&lt;script&gt;&quot;&amp;&#039;/);
  assert.match(rendered.html, /href="https:\/\/app\.miljor\.test\/buyer\/orders\?x=1&amp;y=2"/);
  assert.doesNotMatch(rendered.html, /<script|<img|<b>/);
  assert.match(rendered.text, /اطلاع/);
  const plain = s._renderTemplate('platform_notification', { title: 'Hi', message: 'Ready' });
  assert.match(plain.html, /dir="ltr"/);
  assert.doesNotMatch(plain.html, /<a /);
});

test('reject external and obfuscated links and unsupported locales', () => {
  const s = service(forbiddenDb);
  for (const deepLink of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)',
    '/%2fevil.test', '/%5cevil.test', '/%252fevil.test', '/a\n', '/a%0d', '/a/../..//evil.test', {}, '/%zz']) {
    assert.throws(() => s._renderTemplate('platform_notification', { title: 'Hi', message: 'Ready', deepLink }), { code: 'INVALID_DEEP_LINK' });
  }
  assert.throws(() => s._renderTemplate('platform_notification', { title: 'Hi', message: 'Ready', locale: '<img>' }), { code: 'INVALID_NOTIFICATION' });
});

test('queued mail waits for its quiet-hour or rate-limit release time',async()=>{
  const f=memory();let sends=0;
  const s=service(f.db,async()=>{sends++;return {messageId:'released'};});
  await s.enqueueEmail(f.db,input());
  f.rows[0].next_attempt_at=1000000+60000;
  await s.processOutboxBatch();
  assert.equal(sends,0);
  f.advance(60000);
  await s.processOutboxBatch();
  assert.equal(sends,1);
});

test('competing workers dispatch once while the winner is sending', async () => {
  const f = memory(); let sends = 0; let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const s = service(f.db, async () => { sends++; await held; return { messageId: 'one' }; });
  await s.enqueueEmail(f.db, input());
  // Both SELECTs observe QUEUED before either conditional UPDATE runs.
  const a = s.processOutboxBatch(); const b = s.processOutboxBatch();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sends, 1);
  assert.equal(f.rows[0].status, 'SENDING');
  finish(); await Promise.all([a, b]);
  assert.equal(f.rows[0].status, 'PROVIDER_ACCEPTED');
  assert.equal(f.rows[0].attempt_count, 1);
});

test('crash lease recovers; expired owner cannot overwrite a newer claim', async () => {
  const f = memory(); let finish; let sends = 0;
  const held = new Promise(resolve => { finish = resolve; });
  const s = service(f.db, async () => { sends++; if (sends === 1) { await held; return { messageId: 'stale' }; } return { messageId: 'recovered' }; });
  await s.enqueueEmail(f.db, input());
  const old = s.processOutboxBatch();
  await new Promise(resolve => setImmediate(resolve));
  await s.processOutboxBatch(); assert.equal(sends, 1);
  f.advance(300001); await s.processOutboxBatch();
  finish(); await old;
  assert.equal(sends, 2);
  assert.equal(f.rows[0].provider_message_id, 'recovered');
  assert.equal(f.rows[0].attempt_count, 2);
});

test('redacted failures use exponential backoff and stop after three attempts', async () => {
  const f = memory(); let sends = 0;
  const s = service(f.db, async () => { sends++; throw Error('secret-token buyer@example.test OTP 123456'); });
  await s.enqueueEmail(f.db, input());
  await s.processOutboxBatch();
  assert.equal(f.rows[0].last_error, 'EMAIL_DELIVERY_FAILED');
  await s.processOutboxBatch(); assert.equal(sends, 1);
  f.advance(300000); await s.processOutboxBatch(); assert.equal(sends, 2);
  f.advance(300000); await s.processOutboxBatch(); assert.equal(sends, 2);
  f.advance(300000); await s.processOutboxBatch(); assert.equal(sends, 3);
  f.advance(9999999); await s.processOutboxBatch(); assert.equal(sends, 3);
  assert.equal(f.rows[0].status, 'FAILED');
  assert.doesNotMatch(JSON.stringify(f.trace), /secret-token|123456/);
});

test('third crashed attempt becomes terminal and malformed payload is contained', async () => {
  const f = memory(); let sends = 0;
  const s = service(f.db, async () => { sends++; });
  await s.enqueueEmail(f.db, input());
  Object.assign(f.rows[0], { status: 'SENDING', attempt_count: 3, claim_token: 'dead', claim_expires_at: 0 });
  await s.processOutboxBatch();
  assert.equal(f.rows[0].status, 'FAILED');
  assert.equal(f.rows[0].last_error, 'EMAIL_RETRY_LIMIT_REACHED');
  Object.assign(f.rows[0], { status: 'QUEUED', attempt_count: 0, payload_json: '{bad' });
  await s.processOutboxBatch();
  assert.equal(sends, 0);
  assert.equal(f.rows[0].last_error, 'EMAIL_DELIVERY_FAILED');
});

test('immediate OTP API still inserts, dispatches, and reports provider acceptance', async () => {
  const f = memory(); const sent = [];
  const s = service(f.db, async mail => { sent.push(mail); return { messageId: 'otp-mock' }; });
  const result = await s.queueAndSendEmail(input({ templateName: 'REGISTRATION_OTP', payload: { name: 'Buyer', otp: '123456' } }));
  assert.equal(result.status, 'PROVIDER_ACCEPTED');
  assert.equal(result.message_id, 'otp-mock');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /123456/);
});

test('retry worker cannot claim an OTP being dispatched by the immediate API', async () => {
  const f = memory(); let sends = 0; let finish;
  const held = new Promise(resolve => { finish = resolve; });
  const s = service(f.db, async () => { sends++; await held; return { messageId: 'immediate' }; });
  const immediate = s.queueAndSendEmail(input({ templateName: 'PASSWORD_RESET_OTP', payload: { otp: '123456' } }));
  await new Promise(resolve => setImmediate(resolve));
  const batch = s.processOutboxBatch();
  await new Promise(resolve => setImmediate(resolve));
  finish(); await Promise.all([immediate, batch]);
  assert.equal(sends, 1);
  assert.equal(f.rows[0].attempt_count, 1);
});

test('stale failure cannot clear a newer live claim', async () => {
  const f = memory(); let rejectOld; let finishNew; let sends = 0;
  const oldSend = new Promise((_, reject) => { rejectOld = reject; });
  const newSend = new Promise(resolve => { finishNew = resolve; });
  const s = service(f.db, () => ++sends === 1 ? oldSend : newSend);
  await s.enqueueEmail(f.db, input());
  const old = s.processOutboxBatch();
  await new Promise(resolve => setImmediate(resolve));
  f.advance(300001);
  const fresh = s.processOutboxBatch();
  await new Promise(resolve => setImmediate(resolve));
  const token = f.rows[0].claim_token;
  rejectOld(Error('stale secret')); await old;
  assert.equal(f.rows[0].status, 'SENDING');
  assert.equal(f.rows[0].claim_token, token);
  finishNew({ messageId: 'winner' }); await fresh;
  assert.equal(f.rows[0].provider_message_id, 'winner');
});

test('email links use only trusted configured frontend origin in HTML and text', () => {
  const payload = { title: 'Update', message: 'Ready', deepLink: '/procurement?x=1&y=2',
    origin: 'https://evil.test', APP_FRONTEND_URL: 'https://evil.test', frontendUrl: 'https://evil.test' };
  const s = service(forbiddenDb, undefined, { APP_FRONTEND_URL: 'https://miljor.example/', FRONTEND_URL: 'https://fallback.test' });
  const rendered = s._renderTemplate('platform_notification', payload);
  assert.match(rendered.html, /href="https:\/\/miljor\.example\/procurement\?x=1&amp;y=2"/);
  assert.match(rendered.text, /https:\/\/miljor\.example\/procurement\?x=1&y=2/);
  assert.doesNotMatch(rendered.html + rendered.text, /evil\.test|fallback\.test/);
  const fallback = service(forbiddenDb, undefined, { APP_FRONTEND_URL: undefined, FRONTEND_URL: 'https://fallback.test:8443' });
  assert.match(fallback._renderTemplate('platform_notification', payload).text, /https:\/\/fallback\.test:8443\/procurement/);
});

test('frontend origin rejects unsafe configuration and allows local HTTP only in tests', () => {
  const payload = { title: 'Update', message: 'Ready', deepLink: '/procurement' };
  for (const APP_FRONTEND_URL of [undefined, 'http://miljor.example', 'javascript:alert(1)', '//miljor.example',
    'https://user:pass@miljor.example', 'https://miljor.example/path', 'https://miljor.example?next=evil',
    'https://miljor.example#hash', 'https://miljor.example\\evil', ' https://miljor.example', 'https:miljor.example',
    'https:///miljor.example', 'https://miljor.example/?', 'https://miljor.example/#']) {
    const s = service(forbiddenDb, undefined, { APP_FRONTEND_URL });
    assert.throws(() => s._renderTemplate('platform_notification', payload), { code: 'INVALID_FRONTEND_URL' });
    // No URL configuration is needed when no link is supplied.
    assert.doesNotThrow(() => s._renderTemplate('platform_notification', { title: 'Update', message: 'Ready' }));
  }
  for (const APP_FRONTEND_URL of ['http://localhost:3000', 'http://127.0.0.1:5173', 'http://[::1]:3000']) {
    assert.match(service(forbiddenDb, undefined, { APP_FRONTEND_URL })._renderTemplate('platform_notification', payload).text, /http:\/\//);
    assert.throws(() => service(forbiddenDb, undefined, { APP_FRONTEND_URL, NODE_ENV: 'development' })
      ._renderTemplate('platform_notification', payload), { code: 'INVALID_FRONTEND_URL' });
  }
});

test('late provider success records acceptance while token is still owned, sync and worker', async () => {
  for (const immediate of [true, false]) {
    const f = memory();
    const s = service(f.db, async () => { f.advance(300001); return { messageId: 'late-success' }; });
    let result;
    if (immediate) result = await s.queueAndSendEmail(input());
    else { await s.enqueueEmail(f.db, input()); result = await s.processOutboxBatch(); }
    assert.equal(f.rows[0].status, 'PROVIDER_ACCEPTED');
    assert.equal(f.rows[0].provider_message_id, 'late-success');
    if (immediate) assert.equal(result.status, 'PROVIDER_ACCEPTED');
    else assert.equal(result.succeeded, 1);
  }
});

test('late provider failure records retry while token is still owned, sync and worker', async () => {
  for (const immediate of [true, false]) {
    const f = memory();
    const s = service(f.db, async () => { f.advance(300001); throw Error('provider timeout'); });
    if (immediate) assert.equal((await s.queueAndSendEmail(input())).status, 'FAILED');
    else { await s.enqueueEmail(f.db, input()); assert.equal((await s.processOutboxBatch()).failed, 1); }
    assert.equal(f.rows[0].status, 'FAILED');
    assert.equal(f.rows[0].last_error, 'EMAIL_DELIVERY_FAILED');
  }
});

test('sync success losing token ownership reports acceptance recording pending without touching peer', async () => {
  const f = memory();
  const s = service(f.db, async () => {
    Object.assign(f.rows[0], { claim_token: 'peer-token', provider_message_id: 'peer-message' });
    return { messageId: 'old-send' };
  });
  const result = await s.queueAndSendEmail(input());
  assert.equal(result.status, 'ACCEPTANCE_RECORDING_PENDING');
  assert.equal(result.delivery_ambiguous, true);
  assert.equal(result.message_id, 'old-send');
  assert.equal(f.rows[0].status, 'SENDING');
  assert.equal(f.rows[0].claim_token, 'peer-token');
  assert.equal(f.rows[0].provider_message_id, 'peer-message');
});

test('provider success followed by recording error stays ambiguous instead of recording send failure', async () => {
  for (const immediate of [true, false]) {
    const f = memory();
    const db = { query: async (q, args) => {
      if (q.includes("SET status = 'PROVIDER_ACCEPTED'")) throw Error('database unavailable');
      return f.db.query(q, args);
    } };
    const s = service(db);
    if (immediate) {
      const result = await s.queueAndSendEmail(input());
      assert.equal(result.status, 'ACCEPTANCE_RECORDING_PENDING');
      assert.equal(result.delivery_ambiguous, true);
    } else {
      await s.enqueueEmail(f.db, input());
      const result = await s.processOutboxBatch();
      assert.equal(result.ambiguous, 1);
      assert.equal(result.succeeded, 0);
      assert.equal(result.failed, 0);
    }
    assert.equal(f.rows[0].status, 'SENDING');
    assert.equal(f.rows[0].last_error, undefined);
  }
});

test('stale worker success cannot overwrite a newer live claim and reports ambiguity', async () => {
  const f = memory(); let finishOld; let finishNew; let sends = 0;
  const oldSend = new Promise(resolve => { finishOld = resolve; });
  const newSend = new Promise(resolve => { finishNew = resolve; });
  const s = service(f.db, () => ++sends === 1 ? oldSend : newSend);
  await s.enqueueEmail(f.db, input());
  const old = s.processOutboxBatch();
  await new Promise(resolve => setImmediate(resolve));
  f.advance(300001);
  const fresh = s.processOutboxBatch();
  await new Promise(resolve => setImmediate(resolve));
  const token = f.rows[0].claim_token;
  finishOld({ messageId: 'old-message' });
  const oldResult = await old;
  assert.equal(oldResult.ambiguous, 1);
  assert.equal(oldResult.succeeded, 0);
  assert.equal(f.rows[0].status, 'SENDING');
  assert.equal(f.rows[0].claim_token, token);
  finishNew({ messageId: 'new-message' }); await fresh;
  assert.equal(f.rows[0].provider_message_id, 'new-message');
});

function otpChallenge(f, s, changes = {}) {
  const record = { id: 1, user_id: 5, email: 'buyer@example.test', purpose: 'REGISTRATION_VERIFY',
    otp_hash: s.computeOtpHmac({ otp: '123456', userId: 5, email: 'buyer@example.test', purpose: 'REGISTRATION_VERIFY' }),
    consumed_at: null, attempts_count: 0, expires_at: 1600000, ...changes };
  f.challenges.push(record);
  return record;
}

test('superseded rows are terminal even with a due retry timestamp', async () => {
  const f=memory(); let sends=0;
  const s=service(f.db, async()=>{ sends++; });
  await s.enqueueEmail(f.db,input({templateName:'REGISTRATION_OTP',payload:{otp:'123456'}}));
  Object.assign(f.rows[0],{status:'FAILED',last_error:'SUPERSEDED_BY_NEWER_REQUEST',next_attempt_at:0});
  assert.equal((await s.processOutboxBatch()).processed,0);
  assert.equal(sends,0);
});

test('invalid OTP backlog and retries retire permanently without sending', async () => {
  for (const status of ['QUEUED','FAILED','SENDING']) for (const invalid of ['missing','consumed','expired','exhausted','replaced','wrong-email','wrong-hash','wrong-id']) {
    const f=memory(); let sends=0;
    const s=service(f.db,async()=>{ sends++; return {messageId:'unexpected'}; });
    if(invalid!=='missing') {
      const record=otpChallenge(f,s);
      if(invalid==='consumed') record.consumed_at=1;
      if(invalid==='expired') record.expires_at=1000000;
      if(invalid==='exhausted') record.attempts_count=5;
      if(invalid==='wrong-email') record.email='other@example.test';
      if(invalid==='wrong-hash') record.otp_hash=s.hashOtp('654321');
      if(invalid==='replaced') otpChallenge(f,s,{id:2,consumed_at:1});
    }
    await s.enqueueEmail(f.db,input({templateName:'REGISTRATION_OTP',payload:{otp:'123456',verificationId:invalid==='wrong-id'?99:1}}));
    Object.assign(f.rows[0],{status,attempt_count:status==='QUEUED'?0:1,next_attempt_at:0,claim_token:'crashed',claim_expires_at:0});
    await s.processOutboxBatch();
    assert.equal(sends,0,`${status}: ${invalid}`);
    assert.equal(f.rows[0].last_error,'OTP_CHALLENGE_INVALID');
    assert.equal(f.rows[0].next_attempt_at,null);
    f.advance(9999999);
    assert.equal((await s.processOutboxBatch()).processed,0);
  }
});

test('valid current HMAC and legacy OTP retries still dispatch for both purposes', async () => {
  for(const reset of [false,true]) for(const legacy of [false,true]) {
    const f=memory();let sends=0;
    const s=service(f.db,async()=>{sends++;return {messageId:'valid'};});
    const purpose=reset?'PASSWORD_RESET':'REGISTRATION_VERIFY';
    otpChallenge(f,s,{purpose,otp_hash:legacy?s.hashOtp('123456'):s.computeOtpHmac({otp:'123456',userId:5,email:'buyer@example.test',purpose})});
    await s.enqueueEmail(f.db,input({templateName:reset?'PASSWORD_RESET_OTP':'REGISTRATION_OTP',payload:{otp:'123456'}}));
    Object.assign(f.rows[0],{status:'FAILED',next_attempt_at:0,attempt_count:1});
    assert.equal((await s.processOutboxBatch()).succeeded,1);
    assert.equal(sends,1);
  }
});

test('createAndSendOtp burns a failed immediate challenge and worker never resends it', async () => {
  const f=memory();let sends=0;
  const s=service(f.db,async()=>{sends++;throw Error('provider failure');});
  await assert.rejects(s.createAndSendOtp({userId:5,email:'buyer@example.test'}),{code:'EMAIL_DELIVERY_FAILED'});
  assert.ok(f.challenges[0].consumed_at);
  f.advance(300000);await s.processOutboxBatch();
  assert.equal(sends,1);
  assert.equal(f.rows[0].last_error,'OTP_CHALLENGE_INVALID');
});

test('optional backlog, retries and immediate mail defer in quiet hours without spending attempts', async () => {
  for (const mode of ['backlog','retry','immediate']) {
    const f=memory(); f.setNow('2026-11-16T17:03:25Z'); // Lahore 22:03
    f.preferences.set(5,{quiet_start:'22:00',quiet_end:'08:00',timezone_offset_minutes:300});
    let sends=0; const s=service(f.db,async()=>{sends++;return {messageId:'awake'};});
    if(mode==='immediate') assert.equal((await s.queueAndSendEmail(input())).status,'QUEUED');
    else {
      await s.enqueueEmail(f.db,input());
      if(mode==='retry') Object.assign(f.rows[0],{status:'FAILED',attempt_count:1,next_attempt_at:0});
      await s.processOutboxBatch();
    }
    assert.equal(sends,0);
    assert.equal(f.rows[0].status,'QUEUED');
    assert.equal(f.rows[0].attempt_count,mode==='retry'?1:0);
    assert.equal(f.rows[0].claim_token,null);
    assert.equal(f.rows[0].next_attempt_at,Date.parse('2026-11-17T03:00:00Z'));
    await s.processOutboxBatch();assert.equal(sends,0);
    f.setNow('2026-11-17T03:00:00Z');
    await s.processOutboxBatch();assert.equal(sends,1);
  }
});

test('mandatory notifications and OTPs bypass quiet hours for immediate and worker delivery', async () => {
  for(const immediate of [false,true]) for(const otp of [false,true]) {
    const f=memory();f.setNow('2026-11-16T17:03:00Z');
    f.preferences.set(5,{quiet_start:'22:00',quiet_end:'08:00',timezone_offset_minutes:300});
    let sends=0;const s=service(f.db,async()=>{sends++;return {messageId:'mandatory'};});
    const args=otp?input({templateName:'REGISTRATION_OTP',payload:{otp:'123456'}}):input({payload:{title:'Required',message:'Ready',mandatory:true}});
    if(otp) otpChallenge(f,s,{expires_at:Date.parse('2026-11-16T17:13:00Z')});
    if(immediate) await s.queueAndSendEmail(args);
    else {await s.enqueueEmail(f.db,args);await s.processOutboxBatch();}
    assert.equal(sends,1);
    assert.equal(f.rows[0].status,'PROVIDER_ACCEPTED');
    assert.equal(f.trace.some(item=>item.q.includes('FROM notification_preferences')),false);
  }
});

test('quiet-hours deferral and invalid OTP retirement cannot clear a newer claim', async () => {
  for(const otp of [false,true]) {
    const f=memory();f.setNow('2026-11-16T17:03:00Z');
    f.preferences.set(5,{quiet_start:'22:00',quiet_end:'08:00',timezone_offset_minutes:300});
    const db={query:async(q,args)=>{
      if(q.includes(otp?'FROM email_verifications':'FROM notification_preferences')) f.rows[0].claim_token='peer';
      return f.db.query(q,args);
    }};
    let sends=0;const s=service(db,async()=>{sends++;});
    await s.enqueueEmail(f.db,otp?input({templateName:'REGISTRATION_OTP',payload:{otp:'123456'}}):input());
    assert.equal((await s.processOutboxBatch()).ambiguous,1);
    assert.equal(f.rows[0].claim_token,'peer');
    assert.equal(f.rows[0].status,'SENDING');
    assert.equal(sends,0);
  }
});

test('provider failure before quiet hours defers its actual retry until morning', async () => {
  const f=memory();f.setNow('2026-11-16T16:58:00Z'); // Lahore 21:58
  f.preferences.set(5,{quiet_start:'22:00',quiet_end:'08:00',timezone_offset_minutes:300});
  let sends=0;const s=service(f.db,async()=>{
    if(++sends===1) throw Error('temporary provider failure');
    return {messageId:'morning'};
  });
  await s.enqueueEmail(f.db,input());
  await s.processOutboxBatch();
  assert.equal(f.rows[0].status,'FAILED');
  assert.equal(f.rows[0].next_attempt_at,Date.parse('2026-11-16T17:03:00Z'));
  f.advance(300000);await s.processOutboxBatch();
  assert.equal(sends,1);
  assert.equal(f.rows[0].attempt_count,1);
  assert.equal(f.rows[0].next_attempt_at,Date.parse('2026-11-17T03:00:00Z'));
  // Preferences are re-read rather than retained from enqueue/previous dispatch.
  f.preferences.set(5,{quiet_start:'08:00',quiet_end:'10:00',timezone_offset_minutes:300});
  f.setNow('2026-11-17T03:00:00Z');await s.processOutboxBatch();
  assert.equal(sends,1);
  assert.equal(f.rows[0].next_attempt_at,Date.parse('2026-11-17T05:00:00Z'));
  f.setNow('2026-11-17T05:00:00Z');await s.processOutboxBatch();
  assert.equal(sends,2);
  assert.equal(f.rows[0].status,'PROVIDER_ACCEPTED');
  assert.equal(f.rows[0].attempt_count,2);
});

test('supersession after selection cannot be reclaimed from the stale worker snapshot', async () => {
  const f=memory();let sends=0;
  const db={query:async(q,args)=>{
    const result=await f.db.query(q,args);
    if(q.includes('SELECT id, recipient_email')) Object.assign(f.rows[0],
      {status:'FAILED',last_error:'SUPERSEDED_BY_NEWER_REQUEST',next_attempt_at:null});
    return result;
  }};
  const s=service(db,async()=>{sends++;});
  await s.enqueueEmail(f.db,input({templateName:'REGISTRATION_OTP',payload:{otp:'123456'}}));
  assert.equal((await s.processOutboxBatch()).processed,0);
  assert.equal(sends,0);
  assert.equal(f.rows[0].last_error,'SUPERSEDED_BY_NEWER_REQUEST');
});

test('legacy critical UCP mail without mandatory flag bypasses quiet hours; explicit optional platform mail waits', async () => {
  for (const mode of ['backlog','retry','immediate']) for (const legacy of [true,false]) {
    const f=memory();f.setNow('2026-11-16T17:03:00Z');
    f.preferences.set(5,{quiet_start:'22:00',quiet_end:'08:00',timezone_offset_minutes:300});
    let sends=0;const s=service(f.db,async()=>{sends++;return {messageId:'critical'};});
    const args=input({templateName:legacy?'UCP_NOTIFICATION':'platform_notification',
      payload:legacy?{title:'Payment confirmed',message:'Review your financial record.'}:
        {title:'Optional update',message:'Ready',mandatory:false}});
    if(mode==='immediate') await s.queueAndSendEmail(args);
    else {
      await s.enqueueEmail(f.db,args);
      if(mode==='retry') Object.assign(f.rows[0],{status:'FAILED',attempt_count:1,next_attempt_at:0});
      await s.processOutboxBatch();
    }
    assert.equal(sends,legacy?1:0,`${mode}: ${args.templateName}`);
    assert.equal(f.rows[0].status,legacy?'PROVIDER_ACCEPTED':'QUEUED');
    assert.equal(f.trace.some(item=>item.q.includes('FROM notification_preferences')),!legacy);
    assert.equal(f.rows[0].next_attempt_at,legacy?null:Date.parse('2026-11-17T03:00:00Z'));
  }
});
