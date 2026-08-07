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

export default function App() {
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
