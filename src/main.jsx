import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './branding/fonts.css';
import './branding/study-theme.css';
import './styles.css';
import './brand.css';
import './solid.css';
import { initializeTheme } from './theme.js';
initializeTheme();
try { localStorage.removeItem('pastq-admin-demo-v1'); localStorage.removeItem('pastq-admin-demo-v2'); } catch { /* Storage may be unavailable. */ }
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);


