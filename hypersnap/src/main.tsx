import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initAnalytics } from './lib/analytics';
import { parseRoute } from './lib/navigation';
import './style.scss';
import './social-layout.scss';

initAnalytics(parseRoute(location));
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
