import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { initKeycloak } from './auth/keycloak.js';
import './index.css'

// Initialize Keycloak PKCE auth before rendering the app.
initKeycloak().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    React.createElement(React.StrictMode, null, React.createElement(App))
  );
}).catch((err) => {
  console.error('[Auth] Keycloak initialization failed:', err);
  ReactDOM.createRoot(document.getElementById('root')).render(
    React.createElement(React.StrictMode, null, React.createElement(App))
  );
});
