import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './premium-motion.css';

// PremiumMotion: one self-contained, removable motion layer.
// - Scroll progress hairline (window or inner app scroller)
// - Repeating scroll reveal across Landing, Auth (Login/Register), Buyer, Supplier, and Admin pages
// - Scroll-linked 3D depth on the landing hero frame
// - Subtle pointer tilt on pool cards, benefit rows, hero frame, and workspace/governance cards
// Only toggles CSS classes. Never touches data, routing, forms, or pool logic.
// Revoke anytime:
//   1. Browser instant toggle: localStorage.setItem('miljor_motion', 'off'); location.reload();
//   2. Code toggle: remove <PremiumMotion /> from frontend/src/App.jsx

const REVEAL_SELECTORS = [
  // Landing & Buyer Home
  '.landing-premium-pools > div:first-child',
  '.landing-benefit-copy',
  '.landing-benefit-item',
  '.landing-pool-shell',
  '.miljor-pool-rail > *',
  '.miljor-family-card',
  // Auth (Login, Register, Forgot Password)
  '.auth-box-enhanced',
  // Buyer, Supplier & Admin pages inside AppShell
  'main .grid > *',
  'main article',
  'main section',
  'main [class*="rounded-xl"][class*="border"]',
  'main [class*="rounded-2xl"][class*="border"]',
  'main [class*="rounded-3xl"][class*="border"]',
  'main table',
  'main form',
];

const REVEAL_EXCLUDE = '[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"], .fixed, .miljor-pool-rail, header, nav, aside';

const TILT_SELECTORS = [
  '.landing-pool-shell',
  '.landing-benefit-item',
  '.miljor-commodity-frame',
  'main article[aria-label$="pool"]',
  'main a[class*="rounded-2xl"][class*="border"]',
  'main button[class*="rounded-xl"][class*="border"][class*="text-left"]',
];

const MAX_TILT = 3.5;

export function PremiumMotion() {
  const { pathname } = useLocation();

  useEffect(() => {
    const manualOff =
      window.__MILJOR_DISABLE_MOTION__ === true ||
      window.localStorage?.getItem('miljor_motion') === 'off';
    if (manualOff) return undefined;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const cleanups = [];

    // 1. Scroll progress hairline (all pages, window or inner scroller)
    const bar = document.createElement('div');
    bar.className = 'mj-scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    cleanups.push(() => bar.remove());

    let ticking = false;
    let scroller = null;
    const heroFrames = () => document.querySelectorAll('.landing-premium-hero .miljor-commodity-frame');
    const update = () => {
      ticking = false;
      let top;
      let max;
      if (scroller && scroller.scrollHeight - scroller.clientHeight > 40) {
        top = scroller.scrollTop;
        max = scroller.scrollHeight - scroller.clientHeight;
      } else {
        top = window.scrollY;
        max = document.documentElement.scrollHeight - window.innerHeight;
      }
      const progress = max > 0 ? Math.min(1, Math.max(0, top / max)) : 0;
      bar.style.transform = `scaleX(${progress})`;
      if (!reduce) {
        const depth = Math.min(1, top / 600);
        heroFrames().forEach((el) => {
          el.style.setProperty('--mj-depth-rx', `${(depth * 7).toFixed(2)}deg`);
          el.style.setProperty('--mj-depth-ty', `${(depth * -18).toFixed(1)}px`);
          el.style.setProperty('--mj-depth-scale', (1 - depth * 0.04).toFixed(3));
        });
        const benefitList = document.querySelector('.landing-benefit-list');
        if (benefitList) {
          const items = benefitList.querySelectorAll('.landing-benefit-item');
          const rect = benefitList.getBoundingClientRect();
          const vh = window.innerHeight || 800;
          const entryLine = vh * 0.94;
          const pastEntry = Math.max(0, entryLine - rect.top);
          const remaining = Math.max(0, max - top);
          const p = pastEntry <= 0 ? 0 : remaining <= 2 ? 1 : pastEntry / (pastEntry + remaining);
          const starts = [0.0, 0.24, 0.48];
          items.forEach((item, idx) => {
            item.classList.add('mj-scroll-scrub');
            const start = starts[idx] ?? 0.48;
            const t = Math.min(1, Math.max(0, (p - start) / 0.42));
            const ease = 1 - Math.pow(1 - t, 3);
            item.style.setProperty('--mj-b-op', ease.toFixed(3));
            item.style.setProperty('--mj-b-ty', `${((1 - ease) * 32).toFixed(1)}px`);
            item.style.setProperty('--mj-b-sc', (0.96 + ease * 0.04).toFixed(4));
          });
        }
      }
    };
    const onScroll = (event) => {
      const t = event.target;
      scroller = t instanceof Element && t.scrollHeight - t.clientHeight > 40 ? t : null;
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll, { passive: true });
    cleanups.push(() => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    });
    update();

    if (reduce) return () => cleanups.forEach((fn) => fn());

    // 2. Repeating reveal. Elements fade/rise in when they enter the viewport and
    //    reset when they leave, so the motion replays on every scroll pass up or down.
    const registered = new WeakSet();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('mj-in', entry.isIntersecting);
        });
      },
      { threshold: 0, rootMargin: '40px 0px 40px 0px' },
    );

    const register = () => {
      const nodes = document.querySelectorAll(REVEAL_SELECTORS.join(','));
      nodes.forEach((el) => {
        if (el.classList.contains('landing-benefit-item')) return;
        if (registered.has(el)) return;
        if (el.closest(REVEAL_EXCLUDE)) return;
        const parentTarget = el.parentElement && el.parentElement.closest('.mj-reveal');
        if (parentTarget) return;
        registered.add(el);
        const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
        const index = Math.max(0, siblings.indexOf(el));
        const stepMs = el.classList.contains('landing-pool-shell') || el.closest('.miljor-pool-rail')
          ? 95
          : 65;
        el.style.setProperty('--mj-delay', `${Math.min(index, 6) * stepMs}ms`);
        el.classList.add('mj-reveal');
        io.observe(el);
      });
    };

    let rafId = 0;
    const scheduleRegister = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        register();
      });
    };
    const startTimer = window.setTimeout(register, 80);
    const mo = new MutationObserver(scheduleRegister);
    mo.observe(document.body, { childList: true, subtree: true });

    cleanups.push(() => {
      window.clearTimeout(startTimer);
      if (rafId) window.cancelAnimationFrame(rafId);
      mo.disconnect();
      io.disconnect();
      document.querySelectorAll('.mj-scroll-scrub').forEach((el) => {
        el.classList.remove('mj-scroll-scrub');
        el.style.removeProperty('--mj-b-op');
        el.style.removeProperty('--mj-b-ty');
        el.style.removeProperty('--mj-b-sc');
      });
      document.querySelectorAll('.mj-reveal').forEach((el) => {
        el.classList.remove('mj-reveal', 'mj-in');
        el.style.removeProperty('--mj-delay');
      });
    });

    // 3. Pointer tilt (fine pointers only, non-input cards)
    if (finePointer) {
      const selector = TILT_SELECTORS.join(',');
      let active = null;
      const reset = (el) => {
        el.classList.remove('mj-tilting');
        el.style.removeProperty('--mj-rx');
        el.style.removeProperty('--mj-ry');
      };
      const onMove = (event) => {
        const el = event.target instanceof Element ? event.target.closest(selector) : null;
        if (active && active !== el) reset(active);
        active = el;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;
        el.classList.add('mj-tilting');
        el.style.setProperty('--mj-rx', `${(-py * MAX_TILT).toFixed(2)}deg`);
        el.style.setProperty('--mj-ry', `${(px * MAX_TILT).toFixed(2)}deg`);
      };
      const onLeave = () => {
        if (active) reset(active);
        active = null;
      };
      document.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('pointerleave', onLeave);
      cleanups.push(() => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerleave', onLeave);
        if (active) reset(active);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, [pathname]);

  return null;
}

export default PremiumMotion;
