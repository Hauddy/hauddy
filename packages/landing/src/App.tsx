import GuidePage from './components/GuidePage';
import DemoPage from './components/DemoPage';
import BrandPage from './components/BrandPage';
import { useEffect } from 'react';
import { trackAction } from './acquisition';
import Nav from './components/Nav';
import Hero from './components/Hero';
import Demo from './components/Demo';
import Why from './components/Why';
import Consent from './components/Consent';
import HowItWorks from './components/HowItWorks';
import LocalApp from './components/LocalApp';
import TerminalSection from './components/Terminal';
import Tools from './components/Tools';
import OpenSource from './components/OpenSource';
import Closing from './components/Closing';
import Footer from './components/Footer';
import Privacy from './components/Privacy';
import Reservation from './components/Reservation';
import { pageForPath } from './pages';

export default function App({ pathname }: { pathname: string }) {
  const page = pageForPath(pathname);
  useEffect(() => {
    if (!page.indexable) return;
    trackAction('page_view');
    if (page.path.startsWith('/guides/')) trackAction('guide_open');
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      const href = link?.getAttribute('href') ?? '';
      if (href.includes('api.hauddy.com/download/') || href.toLowerCase().includes('github.com/hauddy/hauddy/releases')) trackAction('download_click');
      if (href.startsWith('/guides/') || href.includes('/docs/')) trackAction('guide_open');
    };
    const play = () => trackAction('demo_play');
    document.addEventListener('click', click); document.addEventListener('play', play, true);
    return () => { document.removeEventListener('click', click); document.removeEventListener('play', play, true); };
  }, [page]);
  if (page.path === '/guides/local-agents') return <GuidePage />;
  if (page.path === '/guides/hosted-assistants') return <GuidePage hosted />;
  if (page.path === '/brand') return <BrandPage />;
  if (page.path === '/demo') return <DemoPage />;
  if (page.path === '/reservation') return <Reservation />;
  if (page.path === '/404') return <main className="section"><h1>Page not found</h1><p>This page does not exist.</p><a href="/">Return to Hauddy</a></main>;
  if (page.path === '/privacy') {
    return <Privacy />;
  }

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Demo />
        <Why />
        <Consent />
        <HowItWorks />
        <LocalApp />
        <TerminalSection />
        <Tools />
        <OpenSource />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
