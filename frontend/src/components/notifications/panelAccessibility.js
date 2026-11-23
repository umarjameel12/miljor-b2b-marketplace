// Non-modal notification dialog: focus enters on open, Escape returns to the
// bell, and tabbing to the rest of the page dismisses it without stealing focus.
export function bindNotificationPanel(root, close) {
  const trigger = root?.querySelector('[data-notification-trigger]');
  const panel = root?.querySelector('[role="dialog"]');
  if (!panel) return () => {};
  (panel.querySelector('[data-notification-close]') || panel).focus();
  const onKeyDown = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
    trigger?.focus();
  };
  const onFocusOut = event => {
    if (event.relatedTarget && !root.contains(event.relatedTarget)) close();
  };
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('focusout', onFocusOut);
  return () => {
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('focusout', onFocusOut);
  };
}
