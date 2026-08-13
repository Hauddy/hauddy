import Nav from './components/Nav';
import Hero from './components/Hero';
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

export default function App() {
  if (window.location.pathname === '/privacy') {
    return <Privacy />;
  }

  return (
    <>
      <Nav />
      <main>
        <Hero />
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
