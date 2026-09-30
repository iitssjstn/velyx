import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './Login';

let server: { name: string; vidalune: { appUrl: string } | null } = { name: 'Thuis', vidalune: null };
vi.mock('../lib/auth', async (original) => ({ ...(await original<typeof import('../lib/auth')>()), useAuth: () => ({ server, setUser: vi.fn() }) }));
afterEach(() => {
  server = { name: 'Thuis', vidalune: null };
});

const renderAt = (path = '/login') => render(<MemoryRouter initialEntries={[path]}><LoginPage /></MemoryRouter>);

describe('signing in', () => {
  it('is only the Vidalune account on a server linked to it; a password only when asked for', async () => {
    server = { name: 'Thuis', vidalune: { appUrl: 'https://app.vidalune.com' } };
    renderAt();
    const vidalune = screen.getByRole('link', { name: 'Sign in with a Vidalune account' });
    expect(vidalune.getAttribute('href')).toBe('https://app.vidalune.com/_vl/servers?choose');
    expect(screen.queryByLabelText('Password')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with a username and password instead' }));
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('asks for a username and password on a server without Vidalune', () => {
    renderAt();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign in with a Vidalune account' })).toBeNull();
  });

  it('says why when the Vidalune account could not sign in, with that account still first', () => {
    server = { name: 'Thuis', vidalune: { appUrl: 'https://app.vidalune.com' } };
    renderAt('/login?vidalune=unknown');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in with a Vidalune account' })).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
});
