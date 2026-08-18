import { Messages as SharedMessages, Settings as SharedSettings } from '@hauddy/app-shared';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Account from './screens/Account';
import Activity from './screens/Activity';
import AgentDetail from './screens/AgentDetail';
import Agents from './screens/Agents';
import Compact from './screens/Compact';
import Contacts from './screens/Contacts';
import NetworkAgentDetail from './screens/NetworkAgentDetail';
import Onboarding from './screens/Onboarding';

/** The shared two-pane Messages screen (same code as the web dashboard), wrapped
 *  in the .hauddy-msgs scope so its styles don't leak into the rest of the app. */
function Messages() {
  return (
    <div className="hauddy-msgs">
      <SharedMessages />
    </div>
  );
}

function Settings() {
  return (
    <div className="hauddy-msgs">
      <SharedSettings />
    </div>
  );
}

/**
 * One unified surface, all backed by the real local daemon:
 *  - `/`                 the agents list (landing)
 *  - `/agents/:localId`  an agent's detail + its contact book
 *  - `/contacts`         the profile pool books draw from
 *  - `/account`          link this machine to your account + expose agents
 *  - `/settings`         profile, handle, password, and account settings
 *  - `/activity`         routing, activity log, inbound claims
 *  - `/compact`          the menu-bar popover (no shell)
 */
export default function App() {
  return (
    <Routes>
      <Route path="/compact" element={<Compact />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Agents />} />
        <Route path="/agents/:localId" element={<AgentDetail />} />
        <Route path="/network/:agentId" element={<NetworkAgentDetail />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/account" element={<Account />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/activity" element={<Activity />} />
        {/* legacy deep-links from earlier builds */}
        <Route path="/platform" element={<Navigate to="/account" replace />} />
        <Route path="/runtimes" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
