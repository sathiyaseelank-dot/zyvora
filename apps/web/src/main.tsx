import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import './index.css';
import { App } from './App';
import { SessionProvider } from './lib/session';

/**
 * BrowserRouter, not MemoryRouter: routes are real URLs so the auth screens
 * can be linked to directly, the header search form can submit without
 * JavaScript state, and the browser's back button works on the reset flow
 * where a user is likely to want it.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
