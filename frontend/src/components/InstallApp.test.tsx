import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

const toastSuccess = vi.fn();
vi.mock('./Toast', () => ({ toast: { success: (m: string) => toastSuccess(m), error: vi.fn() } }));

let standalone = false;
const userAgent = navigator.userAgent;
beforeEach(() => {
  vi.resetModules();
  standalone = false;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' && standalone, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  toastSuccess.mockReset();
});

async function load() {
  const install = await import('../lib/install');
  install.initInstall();
  const { InstallApp, AppBackButton } = await import('./InstallApp');
  return { InstallApp, AppBackButton };
}

function offerInstall(outcome: 'accepted' | 'dismissed') {
  const prompt = vi.fn(async () => undefined);
  const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome }) });
  act(() => void window.dispatchEvent(e));
  return { e, prompt };
}

describe('Install app', () => {
  it('appears once the browser offers installing, and uses the browser’s own confirmation', async () => {
    const { InstallApp } = await load();
    render(<InstallApp />);
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
    const { e, prompt } = offerInstall('accepted');
    // The browser's own banner is replaced by our button.
    expect(e.defaultPrevented).toBe(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Install app' }));
    expect(prompt).toHaveBeenCalledOnce();
    expect(toastSuccess).toHaveBeenCalledWith('Velyx was installed. You can open it from its icon.');
    act(() => void window.dispatchEvent(new Event('appinstalled')));
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });

  it('stays hidden when the user declines, until the browser offers it again', async () => {
    const { InstallApp } = await load();
    render(<InstallApp />);
    offerInstall('dismissed');
    await userEvent.click(await screen.findByRole('button', { name: 'Install app' }));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
    offerInstall('dismissed');
    expect(await screen.findByRole('button', { name: 'Install app' })).toBeTruthy();
  });

  it('explains the Safari steps on an iPhone', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', configurable: true });
    const { InstallApp } = await load();
    render(<InstallApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Install app' }));
    const dialog = screen.getByRole('dialog', { name: 'Install Velyx as an app' });
    expect(dialog.textContent).toContain('Add to Home Screen');
  });

  it('is not offered inside the installed app', async () => {
    standalone = true;
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', configurable: true });
    const { InstallApp } = await load();
    render(<InstallApp />);
    offerInstall('accepted');
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });
});

describe('Back button in the installed app', () => {
  async function renderAt(isApp: boolean) {
    standalone = isApp;
    const { AppBackButton } = await load();
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppBackButton />
        <Link to="/movies">Movies</Link>
        <Link to="/settings/account">Settings</Link>
        <Link to="/movies/5">Dune</Link>
        <Routes>
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('shows on pages below the menu, and goes back', async () => {
    await renderAt(true);
    await userEvent.click(screen.getByRole('link', { name: 'Movies' }));
    // Menu pages have the menu instead, including the tabs of Settings and Admin.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'Dune' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('is left to the browser outside the app', async () => {
    await renderAt(false);
    await userEvent.click(screen.getByRole('link', { name: 'Dune' }));
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

describe('service worker', () => {
  it('is registered at an address that changes with every Velyx version', async () => {
    const { serviceWorkerUrl } = await import('../lib/install');
    expect(serviceWorkerUrl('0.8.0')).toBe('/sw.js?v=0.8.0');
    // The build fills in the version from package.json.
    expect(serviceWorkerUrl()).toMatch(/^\/sw\.js\?v=\d+\.\d+\.\d+$/);
  });
});
