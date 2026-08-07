import { useEffect, useState } from 'react';
import { useReducedMotion, useScrolled } from '../hooks';
import Logo from './Logo';

const LINKS = [
  { href: '#why', label: 'Why it exists' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#terminal', label: 'Inside your harness' },
  { href: '#tools', label: 'Tools' },
  { href: '#opensource', label: 'Open source' },
];

export default function Nav() {
  const scrolled = useScrolled(20);
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState(reduced);

  // arc dash-draw on load (instant under reduced motion)
  useEffect(() => {
    if (reduced) {
      setDrawn(true);
      return;
    }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(id);
  }, [reduced]);

  return (
    <nav className={`nav${scrolled ? ' scrolled' : ''}`}>
      <a href="#top" className="nav-brand">
        <Logo size={24} drawn={drawn} />
        <span className="nav-wordmark">hauddy</span>
      </a>
      <div className="nav-links">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href}>
            {l.label}
          </a>
        ))}
      </div>
      <a href="#waitlist" className="nav-cta">
        Join waitlist
      </a>
    </nav>
  );
}
