import apiClient from './client.js';

const dataOf = response => {
  if (!response.data?.success || !response.data.data) throw new Error('Notification request failed');
  return response.data.data;
};

export const notificationsApi = {
  list: async ({ offset = 0, limit = 20, unread = false, signal } = {}) =>
    dataOf(await apiClient.get('/notifications', { params: { offset, limit, unread }, signal })),
  markRead: async (id, { signal } = {}) =>
    dataOf(await apiClient.patch(`/notifications/${encodeURIComponent(id)}/read`, {}, { signal })),
  markAllRead: async ({ signal } = {}) =>
    dataOf(await apiClient.patch('/notifications/mark-all-read', {}, { signal })),
  getPreferences: async ({ signal } = {}) =>
    dataOf(await apiClient.get('/notifications/preferences', { signal })),
  savePreferences: async (preferences, { signal } = {}) =>
    dataOf(await apiClient.put('/notifications/preferences', preferences, { signal })),
  operations: async ({ signal } = {}) =>
    dataOf(await apiClient.get('/notifications/operations', { signal })),
  retryOperation: async (id, reason, { signal, channel = 'EVENT' } = {}) => {
    if (!['EVENT', 'EMAIL'].includes(channel)) throw new Error('Invalid notification channel');
    const prefix = channel === 'EMAIL' ? 'email/' : '';
    return dataOf(await apiClient.post(`/notifications/operations/${prefix}${encodeURIComponent(id)}/retry`, { reason }, { signal }));
  },
};

function normalizePreferences(data) {
  if (!['en', 'ur'].includes(data?.locale) ||
      ![true, false, 0, 1].includes(data.optional_email) ||
      ![true, false, 0, 1].includes(data.optional_sms) ||
      ![true, false, 0, 1].includes(data.muted_info) ||
      ![data.quiet_start, data.quiet_end].every(value => value === null ||
        (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) ||
      !Number.isInteger(data.timezone_offset_minutes) || Math.abs(data.timezone_offset_minutes) > 840) {
    throw new Error('Invalid preferences response');
  }
  return {
    locale: data.locale, optional_email: Boolean(data.optional_email), optional_sms: Boolean(data.optional_sms),
    muted_info: Boolean(data.muted_info), quiet_start: data.quiet_start, quiet_end: data.quiet_end,
    timezone_offset_minutes: data.timezone_offset_minutes,
  };
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
      if (save) {
        try {
          normalizePreferences(state.values);
          if ((state.values.quiet_start === null) !== (state.values.quiet_end === null)) throw new Error();
        } catch {
          publish({ error: 'Use valid times for both quiet-hour fields, or clear both. Enter a whole timezone offset from -840 to 840 minutes.' });
          return false;
        }
      }
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
      // Keep incomplete form drafts editable; validate before any PUT. Only
      // these recipient preference fields may leave this controller.
      const values = { ...state.values };
      for (const key of Object.keys(values)) {
        if (Object.hasOwn(patch, key)) values[key] = patch[key];
      }
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
      if (next === decoded) return existingNotificationRoute(value);
      decoded = next;
    }
  } catch { return null; }
  return null;
}

// Keep this small allowlist aligned with App.jsx. Unknown internal projections
// get an existing landing page; unsafe/external links never reach this point.
const notificationRoutes = new Set([
  '/', '/pools', '/orders', '/profile', '/procurement', '/demand-requests', '/rfqs', '/flash-pools',
  '/supplier/dashboard', '/supplier/pools', '/supplier/subscription', '/supplier/profile',
  '/supplier/onboarding', '/supplier/catalog', '/admin', '/admin/dashboard', '/admin/verifications',
  '/admin/suppliers/verification', '/admin/catalog',
]);
function existingNotificationRoute(value) {
  const link = value.replace(/^\/rfq(?=[?#]|$)/, '/procurement');
  const path = link.split(/[?#]/, 1)[0];
  if (notificationRoutes.has(path) || /^\/checkout\/\d+$/.test(path)) return link;
  return path === '/catalog' ? '/pools' : '/';
}

export const canManageNotificationOperations = role => ['ADMIN', 'SUPER_ADMIN', 'SUPPORT_ADMIN'].includes(role);
export const notificationOperationKey = failure => `${failure.channel}:${failure.id}`;

export function startNotificationOperations({ role, onChange, api = notificationsApi }) {
  const controller = new AbortController();
  let stopped = false;
  let busy = false;
  let state = { data: null, loading: false, pending: null, error: '', notice: '' };
  const publish = patch => {
    if (stopped) return;
    state = { ...state, ...patch };
    onChange(state);
  };
  const run = async (failure, reason) => {
    if (stopped || busy || !canManageNotificationOperations(role)) return false;
    const id = failure?.id;
    if (failure != null && (!Number.isSafeInteger(Number(id)) || Number(id) < 1 ||
        !['EVENT', 'EMAIL'].includes(failure.channel) || failure.status !== 'FAILED' ||
        !state.data?.failedEvents.some(entry => notificationOperationKey(entry) === notificationOperationKey(failure) && entry.status === 'FAILED') ||
        typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500)) {
      publish({ error: 'Enter a recovery reason of 10–500 characters for a valid failed event.', notice: '' });
      return false;
    }
    busy = true;
    publish({ loading: true, pending: failure ? notificationOperationKey(failure) : null, error: '', notice: '' });
    try {
      if (id != null) {
        const result = await api.retryOperation(id, reason.trim(), { signal: controller.signal, channel: failure.channel });
        if (stopped) return false;
        if (result?.status !== (failure.channel === 'EMAIL' ? 'QUEUED' : 'PENDING')) throw new Error();
        publish({ notice: 'Retry request recorded. Delivery is not confirmed.' });
      }
      const data = await api.operations({ signal: controller.signal });
      if (stopped) return false;
      if (!data.projection || !data.email || !Array.isArray(data.failures)) throw new Error();
      publish({ data: { counts: { projection: data.projection, email: data.email }, failedEvents: data.failures } });
      return true;
    } catch {
      publish({ error: id == null ? 'Notification operations unavailable. Please retry.' :
        'Could not confirm the retry or refresh its status. Refresh before trying again.' });
      return false;
    } finally {
      busy = false;
      publish({ loading: false, pending: null });
    }
  };
  return { load: () => run(), retry: (failure, reason) => run(failure, reason), stop: () => { stopped = true; controller.abort(); } };
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
  let state = { notifications: [], unreadCount: null, offset: 0, unread: false, loading: true, pending: false, error: '' };
  const publish = patch => {
    if (stopped) return;
    state = { ...state, ...patch };
    onChange(state);
  };
  const run = async (mutation, offset = state.offset, unread = state.unread) => {
    if (stopped || busy) return false;
    busy = true;
    cancel(timer);
    publish({ loading: true, pending: Boolean(mutation), error: '' });
    try {
      const result = mutation ? await mutation(controller.signal) : null;
      if (stopped) return false;
      const data = await api.list({ offset, limit: NOTIFICATION_PAGE_SIZE, unread, signal: controller.signal });
      if (!Array.isArray(data.notifications) || !Number.isSafeInteger(data.unreadCount) || data.unreadCount < 0) {
        throw new Error('Invalid notification response');
      }
      failures = 0;
      const stillUnread = result?.updated === false && data.notifications.some(n =>
        String(n.id) === String(mutation?.notificationId) && !isNotificationRead(n));
      publish({ notifications: data.notifications, unreadCount: data.unreadCount, offset, unread,
        error: stillUnread ? 'Read status was not confirmed. Please retry.' : '' });
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
    filterUnread: unread => run(null, 0, Boolean(unread)),
    markRead: id => {
      const mutation = signal => api.markRead(id, { signal });
      mutation.notificationId = id;
      return run(mutation);
    },
    markAllRead: () => run(signal => api.markAllRead({ signal })),
    stop: () => { stopped = true; cancel(timer); controller.abort(); },
  };
}

export const isNotificationRead = notification =>
  notification.is_read === true || notification.is_read === 1 || notification.is_read === '1';
