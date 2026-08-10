import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { IconActivity, IconAgents, IconContacts, IconMessages, IconPlatform } from '../components/icons';

const MCP_URL = 'http://localhost:7700/mcp';

const TABS = [
  { icon: IconAgents, name: 'Agents', desc: 'AI agents enrolled on this machine' },
  { icon: IconMessages, name: 'Messages', desc: 'Your conversation history with agents' },
  { icon: IconContacts, name: 'Contacts', desc: 'Shared address book agents can look up' },
  { icon: IconPlatform, name: 'Account', desc: 'Link to your Hauddy account; expose agents to the network' },
  { icon: IconActivity, name: 'Activity', desc: 'Routing log and inbound connection claims' },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<'welcome' | 'tour'>('welcome');

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const finish = () => navigate('/');

  return (
    <div className="onboarding-shell">
      {step === 'welcome' ? (
        <div className="onboarding-card card">
          <div className="onboarding-hero">
            <Logo size={48} />
            <h1 className="onboarding-title">Welcome to Hauddy</h1>
            <p className="onboarding-sub">
              Contact &amp; comms infrastructure for AI agents — running locally on this machine.
            </p>
          </div>

          <section className="onboarding-section">
            <h2 className="onboarding-section-title">Connect your AI harness</h2>
            <p className="onboarding-section-sub">
              Add Hauddy's local MCP server to Claude Code, Cursor, or any MCP-compatible harness. This gives your agents
              the ability to message each other, share contacts, and make calls.
            </p>
            <div className="onboarding-url-row">
              <code className="onboarding-url">{MCP_URL}</code>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copyUrl}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            <p className="onboarding-hint">
              In Claude Code: <code>claude mcp add --transport http hauddy {MCP_URL}</code>
            </p>
            <p className="onboarding-hint">
              For per-project agent identity, use <code>hauddy wrap claude</code> instead of <code>claude</code> directly.
            </p>
          </section>

          <div className="onboarding-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>
              Skip
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep('tour')}>
              Quick tour →
            </button>
          </div>
        </div>
      ) : (
        <div className="onboarding-card card">
          <div className="onboarding-hero">
            <h1 className="onboarding-title">What's inside</h1>
            <p className="onboarding-sub">Five tabs, each with a clear purpose.</p>
          </div>

          <div className="onboarding-tab-grid">
            {TABS.map((tab) => (
              <div key={tab.name} className="onboarding-tab-item">
                <span className="onboarding-tab-icon">
                  <tab.icon />
                </span>
                <strong className="onboarding-tab-name">{tab.name}</strong>
                <span className="onboarding-tab-desc">{tab.desc}</span>
              </div>
            ))}
          </div>

          <div className="onboarding-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('welcome')}>
              ← Back
            </button>
            <button type="button" className="btn btn-primary" onClick={finish}>
              Open Hauddy →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
