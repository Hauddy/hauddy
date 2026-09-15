import Logo from "./Logo";
const LINKS = [
  ["/", "Home"],
  ["/docs", "Docs"],
  ["/guides", "Guides"],
  ["/demo", "Demo"],
] as const;
/** Short navigation stays visible at every width; no hidden mobile destinations. */
export default function Nav({ pathname = "/" }: { pathname?: string }) {
  return (
    <header className="site-header">
      <a className="site-brand" href="/" aria-label="Hauddy home">
        <Logo size={26} />
        <span>hauddy</span>
      </a>
      <nav className="site-nav" aria-label="Main navigation">
        {LINKS.map(([href, label]) => (
          <a
            key={href}
            href={href}
            aria-current={
              pathname === href ||
              (href !== "/" && pathname.startsWith(href + "/"))
                ? "page"
                : undefined
            }
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="site-actions">
        <a href="https://app.hauddy.com/login">Sign in</a>
        <a className="site-button" href="/#local">
          Download
        </a>
      </div>
    </header>
  );
}
