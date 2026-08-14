import { useEffect, useRef, useState } from 'react';

/** Live prefers-reduced-motion flag. All motion on the page keys off this. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * IntersectionObserver scroll reveal. Returns a ref + visible flag; when
 * reduced motion is on (or IO is missing / stalls), visible is simply true —
 * content is never trapped invisible.
 */
export function useReveal<T extends HTMLElement = HTMLElement>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        }
      },
      { threshold },
    );
    io.observe(el);
    // safety net: backgrounded tabs suspend IO/rAF indefinitely
    const fallback = window.setTimeout(() => setVisible(true), 1400);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, [reduced, threshold]);

  return { ref, visible };
}

/**
 * Like useReveal but toggles continuously — true while the element is in the
 * viewport, false when it leaves. Used to pause animations without resetting them.
 */
export function useInView<T extends HTMLElement = HTMLElement>(threshold = 0.1) {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (reduced) { setInView(true); return; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver(
      (entries) => { for (const en of entries) setInView(en.isIntersecting); },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced, threshold]);

  return { ref, inView };
}

/** True once the page is scrolled past a threshold (nav condense). */
export function useScrolled(threshold = 20): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || window.pageYOffset || 0;
      setScrolled(y > threshold);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}
