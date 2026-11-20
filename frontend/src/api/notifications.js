import apiClient from './client.js';

const dataOf = response => {
  if (!response.data?.success || !response.data.data) throw new Error('Notification request failed');
  return response.data.data;
};

export const notificationsApi = {
  list: async ({ offset = 0, limit = 20, signal } = {}) =>
    dataOf(await apiClient.get('/notifications', { params: { offset, limit }, signal })),
  markRead: async (id, { signal } = {}) =>
    dataOf(await apiClient.patch(`/notifications/${encodeURIComponent(id)}/read`, {}, { signal })),
  markAllRead: async ({ signal } = {}) =>
    dataOf(await apiClient.patch('/notifications/mark-all-read', {}, { signal })),
  getPreferences: async ({ signal } = {}) =>
    dataOf(await apiClient.get('/notifications/preferences', { signal })),
  savePreferences: async (preferences, { signal } = {}) =>
    dataOf(await apiClient.put('/notifications/preferences', preferences, { signal })),
};

function normalizePreferences(data) {
  if (!['en', 'ur'].includes(data?.locale) ||
      ![true, false, 0, 1].includes(data.optional_email) ||
      ![true, false, 0, 1].includes(data.optional_sms)) throw new Error('Invalid preferences response');
  return { locale: data.locale, optional_email: Boolean(data.optional_email), optional_sms: Boolean(data.optional_sms) };
}

// Keep preference requests independent of inbox polling. Each account owns its
// controller and draft; late GET/PUT responses cannot update another account.
export function startNotificationPreferences({ onChange, api = notificationsApi }) {
  const controller = new AbortController();
  let stopped = false;
  let busy = false;
  let state = { values: null, loading: true, pending: false, saved: false, error: '' };
  const publish = patch => {
    if (stopped) return;
    state = { ...state, ...patch };
    onChange(state);
  };
  const run = async save => {
    if (stopped || busy || (save && !state.values)) return false;
    busy = true;
    publish({ loading: !save, pending: save, saved: false, error: '' });
    try {
      const data = save
        ? await api.savePreferences({ ...state.values }, { signal: controller.signal })
        : await api.getPreferences({ signal: controller.signal });
      if (stopped) return false;
      publish({ values: normalizePreferences(data), saved: save });
      return true;
    } catch {
      publish({ error: save ? 'Could not confirm saved preferences. Please retry.' : 'Could not load preferences. Please retry.' });
      return false;
    } finally {
      busy = false;
      publish({ loading: false, pending: false });
    }
  };
  void run(false);
  return {
    load: () => run(false),
    edit: patch => {
      if (stopped || busy || !state.values) return;
      // SMS is deferred in this UI; preserve its backend setting on every save.
      const values = normalizePreferences({ ...state.values,
        locale: patch.locale ?? state.values.locale,
        optional_email: patch.optional_email ?? state.values.optional_email });
      publish({ values, saved: false, error: '' });
    },
    save: () => run(true),
    stop: () => { stopped = true; controller.abort(); },
  };
}

// Only root-relative application links. Decode before checking so encoded
// slashes, backslashes and control characters cannot disguise an external URL.
export function safeNotificationLink(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  let decoded = value;
  try {
    for (let i = 0; i < 5; i++) {
      if ([...decoded].some(char => char === '\\' || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) || decoded.startsWith('//')) return null;
      const next = decodeURIComponent(decoded);
      if (next === decoded) return value.replace(/^\/rfq(?=[?#]|$)/, '/procurement');
      decoded = next;
    }
  } catch { return null; }
  return null;
}

export const NOTIFICATION_PAGE_SIZE = 20;

// One lifecycle per authenticated account. Serialize reads and mutations, abort
// requests on disposal, and never publish a response after disposal.
export function startNotificationInbox({ onChange, api = notificationsApi,
  schedule = setTimeout, cancel = clearTimeout }) {
  let stopped = false;
  let busy = false;
  let timer;
  let failures = 0;
  const controller = new AbortController();
  let state = { notifications: [], unreadCount: null, offset: 0, loading: true, pending: false, error: '' };
  const publish = patch => {
    if (stopped) return;
    state = { ...state, ...patch };
    onChange(state);
  };
  const run = async (mutation, offset = state.offset) => {
    if (stopped || busy) return false;
    busy = true;
    cancel(timer);
    publish({ loading: true, pending: Boolean(mutation), error: '' });
    try {
      const result = mutation ? await mutation(controller.signal) : null;
      if (stopped) return false;
      const data = await api.list({ offset, limit: NOTIFICATION_PAGE_SIZE, signal: controller.signal });
      if (!Array.isArray(data.notifications) || !Number.isSafeInteger(data.unreadCount) || data.unreadCount < 0) {
        throw new Error('Invalid notification response');
      }
      failures = 0;
      publish({ ...data, offset, error: result?.updated === false ? 'Read status was not confirmed. Please retry.' : '' });
      return true;
    } catch {
      failures++;
      publish({ error: mutation ? 'Could not confirm read status. Please retry.' : 'Notifications unavailable. Retrying automatically.' });
      return false;
    } finally {
      busy = false;
      publish({ loading: false, pending: false });
      if (!stopped) timer = schedule(() => run(null), Math.min(30000 * 2 ** Math.min(failures, 3), 240000));
    }
  };
  void run(null);
  return {
    refresh: () => run(null),
    page: offset => run(null, Math.max(0, offset)),
    markRead: id => run(signal => api.markRead(id, { signal })),
    markAllRead: () => run(signal => api.markAllRead({ signal })),
    stop: () => { stopped = true; cancel(timer); controller.abort(); },
  };
}
