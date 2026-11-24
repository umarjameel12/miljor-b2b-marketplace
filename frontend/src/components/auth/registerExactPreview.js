/**
 * MilJor approved Register-page F12 preview, persisted only while RegisterPage is mounted.
 * No backend, form data, validation rules, or other routes are altered.
 */
export function activateRegisterExactPreview() {
  const styleId = 'miljor-register-exact-preview-persisted-v1';
  document.getElementById(styleId)?.remove();

  // Match the approved preview's Lucide-style pin sizes and color values.
  const pin = (color) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  };

  const lightPin = pin('#293C35');
  const darkPin = pin('#D3DED6');
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Remove Register as, but preserve the Buyer/Supplier selector. */
    html[data-mj-exact] [data-mj-hide-label] {
      display: none !important;
    }

    /* Light theme: same simple active styling for Register and selected role. */
    html:not(.dark)[data-mj-exact] .auth-auth-tabs .auth-segment-active,
    html:not(.dark)[data-mj-exact] [data-mj-roles] button.auth-segment-active {
      background: transparent !important;
      background-image: none !important;
      background-color: transparent !important;
      border: 1px solid #C5A36F !important;
      color: #967039 !important;
      font-weight: 700 !important;
      box-shadow: none !important;
    }

    html:not(.dark)[data-mj-exact] [data-mj-roles] button.auth-segment-active svg {
      color: #967039 !important;
      stroke: #967039 !important;
    }

    /* Preserve the original role-button dimensions; avoid hover double lift. */
    html[data-mj-exact] [data-mj-roles] button {
      transform: none !important;
      margin-top: 0 !important;
      min-height: 0 !important;
    }

    html[data-mj-exact] [data-mj-city-label] svg.lucide-map-pin,
    html[data-mj-exact] [data-mj-area-label] svg.lucide-map-pin {
      display: none !important;
    }

    /* Pins inside City/Local Area fields, not in their labels. */
    html[data-mj-exact] input[data-mj-city],
    html[data-mj-exact] select[data-mj-area] {
      padding-left: 42px !important;
      background-image: ${lightPin} !important;
      background-repeat: no-repeat !important;
      background-position: 14px center !important;
      background-size: 16px 16px !important;
    }

    html.dark[data-mj-exact] input[data-mj-city],
    html.dark[data-mj-exact] select[data-mj-area] {
      background-image: ${darkPin} !important;
    }

    /* Approved compact password checklist (no large boxes). */
    html[data-mj-exact] [data-mj-checklist] {
      display: flex !important;
      flex-wrap: wrap !important;
      justify-content: space-between !important;
      align-items: center !important;
      gap: 8px 12px !important;
      padding: 9px 2px 2px !important;
      border-top: 1px solid rgba(160,140,104,.15) !important;
    }

    html[data-mj-exact] [data-mj-checklist] > div {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    html[data-mj-exact] [data-mj-checklist] svg {
      width: 14px !important;
      height: 14px !important;
    }

    html:not(.dark)[data-mj-exact] [data-mj-checklist] svg.lucide-check {
      color: #A77C39 !important;
      stroke: #A77C39 !important;
    }

    html.dark[data-mj-exact] [data-mj-checklist] svg.lucide-check {
      color: #6FC4A5 !important;
      stroke: #6FC4A5 !important;
    }

    /* Landing-style hover lift: Sign In link and Get Started only. */
    html[data-mj-exact] .auth-auth-tabs a[href="/login"],
    html[data-mj-exact] form button[type="submit"] {
      transition: transform .18s ease, box-shadow .18s ease !important;
    }

    html:not(.dark)[data-mj-exact] .auth-auth-tabs a[href="/login"]:hover,
    html:not(.dark)[data-mj-exact] form button[type="submit"]:hover {
      transform: translateY(-2px) !important;
      box-shadow: 0 7px 16px rgba(125,94,47,.14) !important;
    }

    html.dark[data-mj-exact] .auth-auth-tabs a[href="/login"]:hover,
    html.dark[data-mj-exact] form button[type="submit"]:hover {
      transform: translateY(-2px) !important;
      box-shadow: 0 8px 18px rgba(0,0,0,.22) !important;
    }

    /* MJ FINAL TWO-FIX V4 START */
    /* Upper Sign In link beside Register: absolutely no lift in either theme. */
    html body #root .auth-auth-tabs.auth-tabs-premium > a[href="/login"],
    html body #root .auth-auth-tabs.auth-tabs-premium > a[href="/login"]:is(:hover,:active,:focus,:focus-visible) {
      transform: none !important;
      translate: none !important;
      scale: none !important;
      animation: none !important;
      box-shadow: none !important;
      filter: none !important;
      transition: color .15s ease !important;
    }
    /* Dark ONLY: Buyer/Supplier selected background matches Register active.
       Font/icon/border/size unaffected. V2 CSS defines the common theme bg. */
    html.dark body #root [data-mj-roles] > button.auth-segment-active {
      background: var(--mj-auth-v2-bg, var(--bg-surface)) !important;
      background-color: var(--mj-auth-v2-bg, var(--bg-surface)) !important;
      background-image: none !important;
    }
    /* MJ FINAL TWO-FIX V4 END */
  `;
  document.head.appendChild(style);
  document.documentElement.setAttribute('data-mj-exact', '');

  const modified = new Set();
  const mark = (el, attr) => {
    if (el && !el.hasAttribute(attr)) {
      el.setAttribute(attr, '');
      modified.add([el, attr]);
    }
  };

  const city = document.querySelector('input[aria-label="Launch City"]');
  const areaRoot = city?.closest('.auth-box-enhanced') || city?.closest('form')?.parentElement;
  if (!city || !areaRoot) {
    style.remove();
    document.documentElement.removeAttribute('data-mj-exact');
    return () => {};
  }

  const applyMarkers = () => {
    const scope = areaRoot;
    const cityField = scope.querySelector('input[aria-label="Launch City"]');
    const areaField = scope.querySelector('select[aria-label="Local Area"]');

    const registerLabel = [...scope.querySelectorAll('label')]
      .find((label) => label.textContent.trim() === 'Register as');
    mark(registerLabel, 'data-mj-hide-label');

    const roleButtons = [...scope.querySelectorAll('button')]
      .filter((btn) => ['Buyer', 'Supplier'].includes(btn.textContent.trim()));
    if (roleButtons.length === 2 && roleButtons[0].parentElement === roleButtons[1].parentElement) {
      mark(roleButtons[0].parentElement, 'data-mj-roles');
    }

    mark(cityField, 'data-mj-city');
    mark(areaField, 'data-mj-area');
    mark(cityField?.parentElement?.querySelector('label') || cityField?.parentElement?.parentElement?.querySelector('label'), 'data-mj-city-label');
    mark(areaField?.parentElement?.parentElement?.querySelector('label'), 'data-mj-area-label');

    // Checklist is rendered by PasswordStrengthIndicator; its children can be dynamic.
    const text = [...scope.querySelectorAll('span')]
      .find((span) => span.textContent.trim() === '8+ characters');
    mark(text?.parentElement?.parentElement, 'data-mj-checklist');
  };

  applyMarkers();
  // MJ AUTH DIRECT FIX V5 BEGIN
  // Scope limited to Register. Keep existing roles, location fields and password UI intact.
  const mjV5Saved = new Map();
  const mjV5Capture = (node, property) => {
    if (!node) return;
    if (!mjV5Saved.has(node)) mjV5Saved.set(node, new Map());
    const entries = mjV5Saved.get(node);
    if (!entries.has(property)) {
      entries.set(property, [node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]);
    }
  };
  const mjV5Force = (node, property, value) => {
    if (!node || !value) return;
    mjV5Capture(node, property);
    if (node.style.getPropertyValue(property) !== value || node.style.getPropertyPriority(property) !== 'important') {
      node.style.setProperty(property, value, 'important');
    }
  };
  const mjV5Sync = () => {
    const topSignIn = areaRoot.querySelector('.auth-auth-tabs a[href="/login"]');
    if (topSignIn) {
      // Direct inline important wins over old injected hover CSS, without touching colors.
      for (const [prop, val] of [
        ['transform', 'none'], ['translate', 'none'], ['scale', 'none'],
        ['box-shadow', 'none'], ['filter', 'none'], ['animation', 'none'],
        ['transition', 'none']
      ]) mjV5Force(topSignIn, prop, val);
    }
    if (document.documentElement.classList.contains('dark')) {
      const activeRegister = areaRoot.querySelector('.auth-auth-tabs .auth-segment-active');
      const activeRole = [...areaRoot.querySelectorAll('button.auth-segment-active')]
        .find((button) => ['Buyer','Supplier'].includes(button.textContent.trim()));
      if (activeRegister && activeRole) {
        // Use the REAL active Register fill, not a guessed dark hex color.
        const registerStyle = getComputedStyle(activeRegister);
        mjV5Force(activeRole, 'background', registerStyle.background);
      }
    } else {
      // On theme change, restore selected role background to React's original value.
      for (const [node, entries] of mjV5Saved) {
        if (!node.isConnected || !node.matches('button.auth-segment-active')) continue;
        const saved=entries.get('background');
        if (!saved) continue;
        if (saved[0]) node.style.setProperty('background',saved[0],saved[1]);
        else node.style.removeProperty('background');
      }
    }
  };
  mjV5Sync();
  // Watch React role toggles and theme toggles, not style attributes (avoids loops).
  const mjV5Observer = new MutationObserver(() => mjV5Sync());
  mjV5Observer.observe(areaRoot, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  mjV5Observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  // MJ AUTH DIRECT FIX V5 END
  // Handle async loading of the Local Area selector and optional checklist updates.
  const observer = new MutationObserver(() => applyMarkers());
  observer.observe(areaRoot, { childList: true, subtree: true });

  return () => {
    // MJ AUTH DIRECT FIX V5 CLEANUP BEGIN
    mjV5Observer.disconnect();
    for (const [node, props] of mjV5Saved) {
      if (!node.isConnected) continue;
      for (const [property, [value, priority]] of props) {
        if (value) node.style.setProperty(property, value, priority);
        else node.style.removeProperty(property);
      }
    }
    // MJ AUTH DIRECT FIX V5 CLEANUP END
    observer.disconnect();
    style.remove();
    document.documentElement.removeAttribute('data-mj-exact');
    for (const [el, attr] of modified) el.removeAttribute(attr);
  };
}
