import type { ReactNode } from "react";
const SECTIONS = [
  ["/docs", "Start here"],
  ["/docs/installation", "Install & connect"],
  ["/docs/tools", "Tool reference"],
  ["/guides", "Workflow guides"],
  ["/guides/local-agents", "Two local agents"],
  ["/guides/hosted-assistants", "Hosted assistant"],
  ["/demo", "Watch the demo"],
] as const;
export default function DocsLayout({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  return (
    <div className="docs-layout">
      <nav className="docs-nav" aria-label="Documentation">
        <p>Explore Hauddy</p>
        {SECTIONS.map(([href, label]) => (
          <a
            href={href}
            key={href}
            aria-current={href === path ? "page" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <main className="docs-content">{children}</main>
    </div>
  );
}
