import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import './premium-motion.css';

// PremiumMotion: one self-contained, removable motion layer.
// - Scroll progress hairline (window or inner app scroller)
// - Repeating scroll reveal on landing, pools and app pages (replays every time)
// - Scroll-linked 3D depth on the landing hero frame
// - Pointer tilt on pool cards, benefit rows and the hero frame
// Only toggles CSS classes. Never touches data, routing or pool logic.
// Disabled for reduced-motion users. Remove <PremiumMotion /> from App.jsx to turn it all off.

const REVEAL_SELECTORS = [
  // Landing
  '.landing-premium-pools > div:first-child',
  '.landing-premium-benefits',
  '.landing-benefit-item',
  '.landing-pool-shell',
  // Pools and app pages (live data cards, panels, sections)
  'main article',
  'main section',
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
];

const MAX_TILT = 4;

export function PremiumMotion() {
  const { pathname } = useLocation();

  useEffect(() => {
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
    //    reset when they leave, so the motion replays on every scroll pass.
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
        if (registered.has(el)) return;
        if (el.closest(REVEAL_EXCLUDE)) return;
        // Skip nested targets so effects never compound
        const parentTarget = el.parentElement && el.parentElement.closest('.mj-reveal');
        if (parentTarget) return;
        registered.add(el);
        const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
        const index = Math.max(0, siblings.indexOf(el));
        el.style.setProperty('--mj-delay', `${Math.min(index, 5) * 60}ms`);
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
      document.querySelectorAll('.mj-reveal').forEach((el) => {
        el.classList.remove('mj-reveal', 'mj-in');
        el.style.removeProperty('--mj-delay');
      });
    });

    // 3. Pointer tilt (fine pointers only), delegated so live pool cards are covered
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
