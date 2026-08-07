import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { installLocalApi } from './api/local-adapter';
import './index.css';
// Scoped copy of @hauddy/app-shared's styles (under .hauddy-msgs) so the shared
// Messages screen keeps the web look without restyling the rest of the app.
import './messages-scoped.css';

// Point @hauddy/app-shared's screens at the local daemon before anything renders.
installLocalApi();

// HashRouter (not BrowserRouter): the app is served by the local sidecar
// daemon from an unknown mount path, and later from Tauri/Electron — hash
// routing needs no server-side rewrite rules.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
