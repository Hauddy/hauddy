import { useReveal } from '../hooks';
import WaitlistForm from './WaitlistForm';

export default function Closing() {
  const { ref, visible } = useReveal<HTMLElement>();
  return (
    <section id="waitlist" className={`closing reveal${visible ? ' visible' : ''}`} ref={ref}>
      <div className="closing-glow" aria-hidden="true" />
      <div className="closing-inner">
        <h2>Get on the list.</h2>
        <p className="closing-sub">
          We're onboarding a small number of people running their own agents first.
        </p>
        <WaitlistForm source="closing" />
        <p className="no-spam">No spam. One email when we open access.</p>
      </div>
    </section>
  );
}
