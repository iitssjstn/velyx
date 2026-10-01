import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { App } from './App';
import { Toaster } from './components/Toast';
import { initialLanguage, setLanguage } from './i18n';
import { initInstall, registerServiceWorker } from './lib/install';
import { SPLASH_MAX_MS, hideSplash } from './lib/splash';
import './index.css';

initInstall();
registerServiceWorker();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

// The language of this device (or browser) is loaded before the first paint; after signing in the
// account's own language takes over.
const language = initialLanguage();
const ready = language === 'en' ? Promise.resolve() : setLanguage(language).catch(() => undefined);

// The opening screen never stays longer than this, whatever is still loading (or failed).
setTimeout(() => hideSplash(), SPLASH_MAX_MS);

void ready.then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
            <Toaster />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
));
