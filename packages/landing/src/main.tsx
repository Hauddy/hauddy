import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = document.getElementById('root')!;
const app = <React.StrictMode><App pathname={window.location.pathname} /></React.StrictMode>;
// The production build contains React HTML; Vite dev starts with an empty root.
if (root.hasChildNodes()) ReactDOM.hydrateRoot(root, app);
else ReactDOM.createRoot(root).render(app);
