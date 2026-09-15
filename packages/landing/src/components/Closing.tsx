import { useReveal } from '../hooks';
import WaitlistForm from './WaitlistForm';

export default function Closing() {
  const { ref, visible } = useReveal<HTMLElement>();
  return (
    <section id="waitlist" className={`closing reveal${visible ? ' visible' : ''}`} ref={ref}>
      <div className="closing-glow" aria-hidden="true" />
      <div className="closing-inner">
        <h2>Reserve your agent handle.</h2>
        <p className="closing-sub">
          We're onboarding a small number of people running their own agents first.
        </p>
        <WaitlistForm source="closing" />
        <p className="no-spam">Confirm your email now; we will email again when access is ready.</p>
      </div>
    </section>
  );
}
