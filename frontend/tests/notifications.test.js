import assert from 'node:assert/strict';
import { safeNotificationLink, startNotificationInbox, startNotificationPreferences, notificationsApi } from '../src/api/notifications.js';
import apiClient from '../src/api/client.js';

for (const link of ['/orders?order=1#receipt', '/procurement', '/supplier/pools']) {
  assert.equal(safeNotificationLink(link), link);
}
assert.equal(safeNotificationLink('/rfq?request_id=12'), '/procurement?request_id=12');
for (const link of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/%2f%2fevil.test', '/orders\n', null]) {
  assert.equal(safeNotificationLink(link), null);
}

const requests = [];
apiClient.defaults.adapter = async config => {
  requests.push(config);
  return { data: { success: true, data: { notifications: [], unreadCount: 47, updated: false } }, status: 200, statusText: 'OK', headers: {}, config };
};
const abort = new AbortController();
assert.equal((await notificationsApi.list({ offset: 20, signal: abort.signal })).unreadCount, 47);
await notificationsApi.markRead('12', { signal: abort.signal });
await notificationsApi.markAllRead({ signal: abort.signal });
assert.deepEqual(requests.map(r => [r.method, r.url]), [['get', '/notifications'], ['patch', '/notifications/12/read'], ['patch', '/notifications/mark-all-read']]);
assert.equal(requests[0].params.offset, 20);
assert.equal(requests[0].signal, abort.signal);

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
let response = { notifications: [{ id: 7, is_read: 0 }], unreadCount: 47 };
let fail = false;
let readCalls = 0;
let timer;
let delay;
let requestedOffset;
let cleared = false;
let state;
const pending = deferred();
let slow = false;
let lastSignal;
const api = {
  list: async ({ signal, offset }) => { requestedOffset = offset; lastSignal = signal; if (slow) return pending.promise; if (fail) throw new Error('offline'); return response; },
  markRead: async () => { readCalls++; return { updated: false }; },
  markAllRead: async () => { response = { ...response, unreadCount: 0, notifications: [{ id: 7, is_read: 1 }] }; },
};
const inbox = startNotificationInbox({ api, onChange: value => { state = value; }, schedule: (fn, ms) => { timer = fn; delay = ms; return 1; }, cancel: () => { cleared = true; } });
await tick();
assert.equal(state.unreadCount, 47, 'count is server total, not loaded row count');
await inbox.markRead(7);
assert.equal(readCalls, 1);
assert.equal(state.notifications[0].is_read, 0, 'updated:false must not fabricate read success');
assert.ok(state.error);
await inbox.markAllRead();
assert.equal(state.unreadCount, 0);
assert.equal(state.notifications[0].is_read, 1);
await inbox.page(20);
assert.equal(requestedOffset, 20);
assert.equal(state.offset, 20);
assert.equal(delay, 30000);
fail = true;
await timer();
assert.ok(state.error, 'poll failure is visible');
assert.equal(state.notifications.length, 1, 'transient failure retains history');
assert.equal(delay, 60000, 'failures back off');
for (let i = 0; i < 4; i++) await timer();
assert.equal(delay, 240000, 'retry delay is bounded');
fail = false;
await timer();
assert.equal(state.error, '');
assert.equal(delay, 30000, 'recovery restores normal polling');
slow = true;
const refresh = inbox.refresh();
await tick();
assert.equal(await inbox.markRead(7), false, 'overlapping requests do not race');
assert.equal(readCalls, 1);
const beforeStop = state;
inbox.stop();
assert.equal(lastSignal.aborted, true);
assert.ok(cleared);
pending.resolve({ notifications: [{ id: 999 }], unreadCount: 999 });
await refresh;
assert.equal(state, beforeStop, 'old account response cannot publish after cleanup');
let newState;
const newInbox = startNotificationInbox({ api: { ...api, list: async () => ({ notifications: [], unreadCount: 3 }) }, onChange: value => { newState = value; } });
await tick();
assert.equal(newState.unreadCount, 3, 'new account has an independent count');
assert.equal(newState.notifications.length, 0);
newInbox.stop();
console.log('PASS: notification API, safe links, authoritative reads/count, polling failure, cancellation and stale account response');

apiClient.defaults.adapter = async config => {
  requests.push(config);
  return { data: { success: true, data: { locale: 'ur', optional_email: 0, optional_sms: 1 } }, status: 200, statusText: 'OK', headers: {}, config };
};
await notificationsApi.getPreferences({ signal: abort.signal });
await notificationsApi.savePreferences({ locale: 'en', optional_email: true, optional_sms: false }, { signal: abort.signal });
assert.deepEqual(requests.slice(-2).map(r => [r.method, r.url]), [['get', '/notifications/preferences'], ['put', '/notifications/preferences']]);
assert.deepEqual(JSON.parse(requests.at(-1).data), { locale: 'en', optional_email: true, optional_sms: false });
assert.equal(requests.at(-1).signal, abort.signal);

let preferencesState;
let failPreferences = true;
let savePayload;
let preferencesSignal;
const savePending = deferred();
const preferencesApi = {
  getPreferences: async () => { if (failPreferences) throw new Error('offline'); return { locale: 'ur', optional_email: 0, optional_sms: 1 }; },
  savePreferences: async (payload, { signal }) => { savePayload = payload; preferencesSignal = signal; return savePending.promise; },
};
const preferences = startNotificationPreferences({ api: preferencesApi, onChange: value => { preferencesState = value; } });
await tick();
assert.ok(preferencesState.error);
assert.equal(preferencesState.values, null, 'failed GET must not invent defaults');
failPreferences = false;
await preferences.load();
assert.deepEqual(preferencesState.values, { locale: 'ur', optional_email: false, optional_sms: true });
preferences.edit({ locale: 'en', optional_email: true });
const saving = preferences.save();
assert.equal(preferencesState.saved, false, 'pending PUT must not show saved');
assert.equal(preferencesState.pending, true);
assert.deepEqual(savePayload, { locale: 'en', optional_email: true, optional_sms: true }, 'deferred SMS preference is preserved');
savePending.resolve({ locale: 'en', optional_email: 1, optional_sms: 1 });
await saving;
assert.equal(preferencesState.saved, true);
preferences.edit({ optional_email: false });
assert.equal(preferencesState.saved, false, 'editing clears previous saved confirmation');
preferences.stop();
assert.equal(preferencesSignal.aborted, true);

for (const operation of ['load', 'save']) {
  const oldResponse = deferred();
  let oldState;
  let oldSignal;
  const old = startNotificationPreferences({ api: {
    getPreferences: async ({ signal }) => { oldSignal = signal; return operation === 'load' ? oldResponse.promise : { locale: 'en', optional_email: 1, optional_sms: 0 }; },
    savePreferences: async (_, { signal }) => { oldSignal = signal; return oldResponse.promise; },
  }, onChange: value => { oldState = value; } });
  await tick();
  const pendingSave = operation === 'save' ? old.save() : null;
  const beforeCleanup = oldState;
  old.stop();
  assert.equal(oldSignal.aborted, true);
  let currentState;
  const current = startNotificationPreferences({ api: { getPreferences: async () => ({ locale: 'ur', optional_email: 0, optional_sms: 0 }) }, onChange: value => { currentState = value; } });
  await tick();
  oldResponse.resolve({ locale: 'en', optional_email: 1, optional_sms: 1 });
  await pendingSave;
  await tick();
  assert.equal(oldState, beforeCleanup, `stale ${operation} cannot publish after account switch`);
  assert.equal(currentState.values.locale, 'ur');
  assert.equal(currentState.saved, false);
  current.stop();
}
let failedSaveState;
const failedSave = startNotificationPreferences({ api: {
  getPreferences: async () => ({ locale: 'en', optional_email: 1, optional_sms: 0 }),
  savePreferences: async () => { throw new Error('offline'); },
}, onChange: value => { failedSaveState = value; } });
await tick();
await failedSave.save();
assert.ok(failedSaveState.error);
assert.equal(failedSaveState.saved, false);
failedSave.stop();
console.log('PASS: preference GET/PUT, numeric normalization, confirmed save, errors, preserved SMS, stale load/save account isolation');
