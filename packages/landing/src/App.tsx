import Home from "./components/Home";
import DocsPage from "./components/DocsPage";
import GuidesIndex from "./components/GuidesIndex";
import AboutPage from "./components/AboutPage";
import GuidePage from "./components/GuidePage";
import DemoPage from "./components/DemoPage";
import BrandPage from "./components/BrandPage";
import { useEffect } from "react";
import { trackAction } from "./acquisition";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import Privacy from "./components/Privacy";
import Reservation from "./components/Reservation";
import { pageForPath } from "./pages";

export default function App({ pathname }: { pathname: string }) {
  const page = pageForPath(pathname);
  useEffect(() => {
    if (!page.indexable) return;
    trackAction("page_view");
    if (page.path.startsWith("/guides/")) trackAction("guide_open");
    const click = (event: MouseEvent) => {
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      const href = link?.getAttribute("href") ?? "";
      if (
        href.includes("api.hauddy.com/download/") ||
        href.toLowerCase().includes("github.com/hauddy/hauddy/releases")
      )
        trackAction("download_click");
      if (href.startsWith("/guides/") || href.includes("/docs/"))
        trackAction("guide_open");
    };
    const play = () => trackAction("demo_play");
    document.addEventListener("click", click);
    document.addEventListener("play", play, true);
    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("play", play, true);
    };
  }, [page]);
  useEffect(() => {
    if (page.path !== "/") return;
    const redirects: Record<string, string> = {
      "#tools": "/docs/tools",
      "#terminal": "/docs/installation#example",
      "#why": "/about",
    };
    const followLegacyAnchor = () => {
      const target = redirects[window.location.hash];
      if (target) window.location.replace(target);
    };
    followLegacyAnchor();
    window.addEventListener("hashchange", followLegacyAnchor);
    return () => window.removeEventListener("hashchange", followLegacyAnchor);
  }, [page.path]);
  if (page.path === "/reservation") return <Reservation />;
  const content =
    page.path === "/guides/local-agents" ? (
      <GuidePage />
    ) : page.path === "/guides/hosted-assistants" ? (
      <GuidePage hosted />
    ) : page.path === "/guides" ? (
      <GuidesIndex />
    ) : page.path.startsWith("/docs") ? (
      <DocsPage path={page.path} />
    ) : page.path === "/about" ? (
      <AboutPage />
    ) : page.path === "/brand" ? (
      <BrandPage />
    ) : page.path === "/demo" ? (
      <DemoPage />
    ) : page.path === "/privacy" ? (
      <Privacy />
    ) : page.path === "/404" ? (
      <main className="docs-content about-page">
        <h1>Page not found</h1>
        <p>This page does not exist.</p>
        <a href="/">Return to Hauddy</a>
      </main>
    ) : (
      <Home />
    );
  return (
    <>
      <Nav pathname={page.path} />
      {content}
      <Footer />
    </>
  );
}
