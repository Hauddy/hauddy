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
