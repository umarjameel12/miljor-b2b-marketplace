import assert from 'node:assert/strict';
import { safeNotificationLink, startNotificationInbox, startNotificationPreferences, notificationsApi, isNotificationRead, canManageNotificationOperations, startNotificationOperations, notificationOperationKey } from '../src/api/notifications.js';
import apiClient from '../src/api/client.js';
import { bindNotificationPanel } from '../src/components/notifications/panelAccessibility.js';

const extendedPreferences = { muted_info: false, quiet_start: null, quiet_end: null, timezone_offset_minutes: 300 };

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
  return { data: { success: true, data: { ...extendedPreferences, locale: 'ur', optional_email: 0, optional_sms: 1 } }, status: 200, statusText: 'OK', headers: {}, config };
};
await notificationsApi.getPreferences({ signal: abort.signal });
await notificationsApi.savePreferences({ ...extendedPreferences, locale: 'en', optional_email: true, optional_sms: false }, { signal: abort.signal });
assert.deepEqual(requests.slice(-2).map(r => [r.method, r.url]), [['get', '/notifications/preferences'], ['put', '/notifications/preferences']]);
assert.deepEqual(JSON.parse(requests.at(-1).data), { ...extendedPreferences, locale: 'en', optional_email: true, optional_sms: false });
assert.equal(requests.at(-1).signal, abort.signal);

let preferencesState;
let failPreferences = true;
let savePayload;
let preferencesSignal;
const savePending = deferred();
const preferencesApi = {
  getPreferences: async () => { if (failPreferences) throw new Error('offline'); return { ...extendedPreferences, locale: 'ur', optional_email: 0, optional_sms: 1 }; },
  savePreferences: async (payload, { signal }) => { savePayload = payload; preferencesSignal = signal; return savePending.promise; },
};
const preferences = startNotificationPreferences({ api: preferencesApi, onChange: value => { preferencesState = value; } });
await tick();
assert.ok(preferencesState.error);
assert.equal(preferencesState.values, null, 'failed GET must not invent defaults');
failPreferences = false;
await preferences.load();
assert.deepEqual(preferencesState.values, { ...extendedPreferences, locale: 'ur', optional_email: false, optional_sms: true });
preferences.edit({ ...extendedPreferences, locale: 'en', optional_email: true });
const saving = preferences.save();
assert.equal(preferencesState.saved, false, 'pending PUT must not show saved');
assert.equal(preferencesState.pending, true);
assert.deepEqual(savePayload, { ...extendedPreferences, locale: 'en', optional_email: true, optional_sms: true }, 'unchanged SMS and extended preferences are preserved');
savePending.resolve({ ...extendedPreferences, locale: 'en', optional_email: 1, optional_sms: 1 });
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
    getPreferences: async ({ signal }) => { oldSignal = signal; return operation === 'load' ? oldResponse.promise : { ...extendedPreferences, locale: 'en', optional_email: 1, optional_sms: 0 }; },
    savePreferences: async (_, { signal }) => { oldSignal = signal; return oldResponse.promise; },
  }, onChange: value => { oldState = value; } });
  await tick();
  const pendingSave = operation === 'save' ? old.save() : null;
  const beforeCleanup = oldState;
  old.stop();
  assert.equal(oldSignal.aborted, true);
  let currentState;
  const current = startNotificationPreferences({ api: { getPreferences: async () => ({ ...extendedPreferences, locale: 'ur', optional_email: 0, optional_sms: 0 }) }, onChange: value => { currentState = value; } });
  await tick();
  oldResponse.resolve({ ...extendedPreferences, locale: 'en', optional_email: 1, optional_sms: 1 });
  await pendingSave;
  await tick();
  assert.equal(oldState, beforeCleanup, `stale ${operation} cannot publish after account switch`);
  assert.equal(currentState.values.locale, 'ur');
  assert.equal(currentState.saved, false);
  current.stop();
}
let failedSaveState;
const failedSave = startNotificationPreferences({ api: {
  getPreferences: async () => ({ ...extendedPreferences, locale: 'en', optional_email: 1, optional_sms: 0 }),
  savePreferences: async () => { throw new Error('offline'); },
}, onChange: value => { failedSaveState = value; } });
await tick();
await failedSave.save();
assert.ok(failedSaveState.error);
assert.equal(failedSaveState.saved, false);
failedSave.stop();
console.log('PASS: preference GET/PUT, numeric normalization, confirmed save, errors, preserved SMS, stale load/save account isolation');

// All recipient settings round-trip; drafts permit entering paired times one
// field at a time, but incomplete/invalid preferences must never reach PUT.
let settings;
let payload;
let saves = 0;
const settingsSession = startNotificationPreferences({ api: {
  getPreferences: async () => ({ ...extendedPreferences, locale: 'en', optional_email: 1, optional_sms: 0, muted_info: 1 }),
  savePreferences: async value => { saves++; payload = value; return value; },
}, onChange: value => { settings = value; } });
await tick();
assert.equal(settings.values.muted_info, true, 'numeric mute flag normalizes');
settingsSession.edit({ optional_sms: true, muted_info: false, quiet_start: '22:30', timezone_offset_minutes: -240, user_id: 999 });
assert.equal(await settingsSession.save(), false);
assert.equal(saves, 0, 'one-sided quiet hours do not reach backend');
assert.ok(settings.error);
settingsSession.edit({ quiet_end: '06:15' });
assert.equal(await settingsSession.save(), true);
assert.deepEqual(payload, { locale: 'en', optional_email: true, optional_sms: true, muted_info: false,
  quiet_start: '22:30', quiet_end: '06:15', timezone_offset_minutes: -240 });
assert.equal(settings.saved, true, 'overnight quiet hours confirmed by backend');
for (const patch of [
  { quiet_start: '24:00' }, { quiet_end: '10:60' }, { timezone_offset_minutes: 841 },
  { timezone_offset_minutes: -841 }, { timezone_offset_minutes: 1.5 }, { timezone_offset_minutes: '' },
  { optional_sms: 'true' }, { muted_info: 'false' }, { locale: 'xx' },
]) {
  settingsSession.edit({ ...payload, ...patch });
  const count = saves;
  assert.equal(await settingsSession.save(), false, JSON.stringify(patch));
  assert.equal(saves, count, 'invalid draft rejected before PUT');
  assert.equal(settings.saved, false);
}
settingsSession.edit({ ...payload, quiet_start: null, quiet_end: null, timezone_offset_minutes: 300 });
await settingsSession.save();
assert.equal(payload.quiet_start, null);
assert.equal(payload.quiet_end, null);
settingsSession.stop();

let invalidState;
const invalidSession = startNotificationPreferences({ api: {
  getPreferences: async () => ({ ...extendedPreferences, locale: 'en', optional_email: 1, optional_sms: 0, quiet_start: '18:30:00' }),
}, onChange: value => { invalidState = value; } });
await tick();
assert.equal(invalidState.values, null, 'malformed server response does not fabricate settings');
assert.ok(invalidState.error);
invalidSession.stop();

await notificationsApi.list({ unread: true, limit: 10, offset: 40 });
assert.equal(requests.at(-1).params.unread, true);
assert.equal(requests.at(-1).params.limit, 10);
let filteredState;
let filterRequest;
let alreadyRead = false;
const filtered = startNotificationInbox({ api: {
  list: async args => { filterRequest = args; return { notifications: [{ id: 9, is_read: alreadyRead ? 1 : 0 }], unreadCount: alreadyRead ? 0 : 1 }; },
  markRead: async () => { alreadyRead = true; return { updated: false }; },
  markAllRead: async () => { throw new Error('offline'); },
}, onChange: value => { filteredState = value; } });
await tick();
await filtered.page(20);
await filtered.filterUnread(true);
assert.equal(filterRequest.offset, 0, 'filter resets pagination');
assert.equal(filterRequest.unread, true);
assert.equal(filteredState.unread, true);
await filtered.markRead(9);
assert.equal(filteredState.error, '', 'another device already marking read is an authoritative success');
assert.equal(filteredState.unreadCount, 0);
assert.ok(isNotificationRead(filteredState.notifications[0]));
await filtered.markAllRead();
assert.ok(filteredState.error, 'failed mutation remains visible');
assert.equal(filteredState.unreadCount, 0, 'failed mutation preserves server state');
filtered.stop();
for (const value of [true, 1, '1']) assert.equal(isNotificationRead({ is_read: value }), true);
for (const value of [false, 0, '0', null, undefined]) assert.equal(isNotificationRead({ is_read: value }), false);
for (const link of ['/%5cevil.test', '/%252f%252fevil.test', '/orders%0a', '/%ZZ']) assert.equal(safeNotificationLink(link), null);
console.log('PASS: complete preference contract, validation, SMS/mute/overnight quiet hours, null clearing, unread filtering and idempotent read refresh');

// DOM event doubles verify actual focus/dismissal handlers without a browser.
const listeners = new Map();
let focused;
let closed = 0;
const trigger = { focus: () => { focused = 'trigger'; } };
const closeButton = { focus: () => { focused = 'close'; } };
const panel = { querySelector: () => closeButton };
const root = {
  querySelector: selector => selector === '[role="dialog"]' ? panel : trigger,
  addEventListener: (name, handler) => listeners.set(name, handler),
  removeEventListener: name => listeners.delete(name),
  contains: target => target === closeButton || target === trigger,
};
const cleanup = bindNotificationPanel(root, () => { closed++; });
assert.equal(focused, 'close', 'opening moves focus into dialog');
listeners.get('keydown')({ key: 'Enter' });
assert.equal(closed, 0);
let prevented = false;
listeners.get('keydown')({ key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation() {} });
assert.equal(closed, 1);
assert.equal(prevented, true);
assert.equal(focused, 'trigger', 'Escape restores bell focus');
listeners.get('focusout')({ relatedTarget: closeButton });
assert.equal(closed, 1, 'internal focus movement keeps dialog open');
listeners.get('focusout')({ relatedTarget: {} });
assert.equal(closed, 2, 'tabbing away dismisses dialog');
assert.equal(focused, 'trigger', 'tab dismissal does not steal focus');
cleanup();
assert.equal(listeners.size, 0);
assert.doesNotThrow(() => bindNotificationPanel(null, () => {})());
console.log('PASS: notification keyboard focus, Escape, tab dismissal and listener cleanup');

for (const path of ['/pools?pool_id=7', '/orders?order_id=8', '/profile?account_id=9', '/admin']) {
  assert.equal(safeNotificationLink(path), path, 'canonical existing route retained');
}
assert.equal(safeNotificationLink('/catalog?catalog_id=3'), '/pools', 'missing catalog route falls back');
assert.equal(safeNotificationLink('/missing-route?token=x'), '/', 'unknown internal route falls back without its query');
for (const role of ['ADMIN', 'SUPER_ADMIN', 'SUPPORT_ADMIN']) assert.ok(canManageNotificationOperations(role));
for (const role of ['BUYER', 'SUPPLIER', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', null]) {
  assert.equal(canManageNotificationOperations(role), false);
  let called = false;
  const denied = startNotificationOperations({ role, api: {
    operations: async () => { called = true; }, retryOperation: async () => { called = true; },
  }, onChange: () => { throw new Error('forbidden role published operations'); } });
  assert.equal(await denied.load(), false);
  assert.equal(await denied.retry(1, 'Investigated failed event'), false);
  assert.equal(called, false, 'forbidden roles make no operations requests');
  denied.stop();
}
await notificationsApi.operations({ signal: abort.signal });
await notificationsApi.retryOperation(12, 'Investigated failed event', { signal: abort.signal });
assert.deepEqual(requests.slice(-2).map(r => [r.method, r.url]), [
  ['get', '/notifications/operations'], ['post', '/notifications/operations/12/retry'],
]);
assert.deepEqual(JSON.parse(requests.at(-1).data), { reason: 'Investigated failed event' });
assert.equal(requests.at(-1).signal, abort.signal);
let operationsState;
let operationsFail = false;
let retryFail = false;
let retryCount = 0;
let retryReason;
let retryChannel;
let operationsSignal;
const health = { projection: { pending: 2, failed: 1, deadLetter: 1, suppressed: 3 },
  email: { queued: 2, sending: 0, failed: 1, terminalFailed: 1 },
  failures: [{ id: 12, channel: 'EVENT', eventType: 'POOL_FAILED', status: 'FAILED', attemptCount: 5, lastErrorCode: 'DELIVERY_FAILED' }, { id: 12, channel: 'EMAIL', eventType: 'UCP_NOTIFICATION', status: 'FAILED', attemptCount: 3, lastErrorCode: 'EMAIL_DELIVERY_FAILED' }] };
const operations = startNotificationOperations({ role: 'SUPPORT_ADMIN', onChange: value => { operationsState = value; }, api: {
  operations: async ({ signal }) => { operationsSignal = signal; if (operationsFail) throw new Error('offline'); return health; },
  retryOperation: async (_, reason, { channel }) => { retryCount++; retryReason = reason; retryChannel = channel; if (retryFail) throw new Error('denied'); return { id: 12, status: channel === 'EMAIL' ? 'QUEUED' : 'PENDING' }; },
} });
await operations.load();
assert.deepEqual(operationsState.data.counts, { projection: health.projection, email: health.email });
assert.equal(operationsState.data.failedEvents[0].attemptCount, 5);
for (const reason of ['', 'short', 'x'.repeat(501)]) assert.equal(await operations.retry(health.failures[0], reason), false);
assert.equal(await operations.retry({ ...health.failures[0], id: 'bad-id' }, 'Investigated failed event'), false);
assert.equal(retryCount, 0, 'invalid retries never reach backend');
assert.equal(await operations.retry(health.failures[0], '  Investigated failed event  '), true);
assert.equal(retryReason, 'Investigated failed event');
assert.equal(retryChannel, 'EVENT');
assert.equal(await operations.retry(health.failures[1], 'Investigated failed email'), true);
assert.equal(retryChannel, 'EMAIL');
assert.match(operationsState.notice, /Delivery is not confirmed/);
assert.notEqual(notificationOperationKey(health.failures[0]), notificationOperationKey(health.failures[1]), 'same event/email IDs have independent reasons and pending state');
for (const status of ['SENDING', 'QUEUED', 'SENT', 'ACCEPTED', 'PROVIDER_ACCEPTED', 'PENDING']) {
  const before = retryCount;
  assert.equal(await operations.retry({ ...health.failures[1], status }, 'Investigated failed email'), false);
  assert.equal(retryCount, before, `${status} must not reach retry endpoint`);
}
assert.equal(await operations.retry({ ...health.failures[1], channel: 'SMS' }, 'Investigated failed email'), false);
assert.equal(await operations.retry({ ...health.failures[1], id: 999 }, 'Investigated failed email'), false);


retryFail = true;
assert.equal(await operations.retry(health.failures[0], 'Investigated failed event'), false);
assert.ok(operationsState.error);
assert.equal(operationsState.notice, '', 'failed request never reports delivery or retry success');
operationsFail = true;
const previousData = operationsState.data;
await operations.load();
assert.ok(operationsState.error);
assert.equal(operationsState.data, previousData, 'failed refresh preserves previously observed status');
operations.stop();
assert.equal(operationsSignal.aborted, true);

let lateState;
let lateSignal;
const lateHealth = deferred();
const oldOperations = startNotificationOperations({ role: 'ADMIN', onChange: value => { lateState = value; }, api: {
  operations: async ({ signal }) => { lateSignal = signal; return lateHealth.promise; },
} });
const lateLoad = oldOperations.load();
assert.equal(await oldOperations.retry(12, 'Investigated failed event'), false, 'overlapping operations serialize');
const beforeDisposal = lateState;
oldOperations.stop();
lateHealth.resolve(health);
await lateLoad;
assert.equal(lateSignal.aborted, true);
assert.equal(lateState, beforeDisposal, 'disposed account cannot publish operations');
console.log('PASS: existing-route fallbacks, operations role guards/API contract/counts, validated audited retry requests, errors and account disposal');

await notificationsApi.retryOperation(12, 'Investigated failed email', { signal: abort.signal, channel: 'EMAIL' });
assert.equal(requests.at(-1).url, '/notifications/operations/email/12/retry');
assert.deepEqual(JSON.parse(requests.at(-1).data), { reason: 'Investigated failed email' });
assert.equal(requests.at(-1).signal, abort.signal);
const requestCount = requests.length;
await assert.rejects(() => notificationsApi.retryOperation(12, 'Investigated failed email', { channel: 'SMS' }));
assert.equal(requests.length, requestCount, 'unknown channels cannot default to event retry');
console.log('PASS: EVENT/EMAIL retry endpoints, mixed-channel ID isolation and FAILED-only retry controls');
