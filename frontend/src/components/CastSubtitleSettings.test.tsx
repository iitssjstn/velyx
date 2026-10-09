import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CastSubtitleSettings } from './CastSubtitleSettings';
import { getPrefs, setPrefs, syncSubtitlePrefs } from '../lib/prefs';
import { api } from '../lib/api';
import { t } from '../i18n';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('previews the TV default and immediately saves a custom colour', () => {
  setPrefs({ castSubtitleDefaults: true });
  render(<CastSubtitleSettings />);
  expect(screen.getByLabelText(t('subtitleStyle.castPreview')).firstElementChild).toHaveProperty('style.color', 'rgb(255, 255, 255)');
  fireEvent.change(screen.getByLabelText(t('subtitleStyle.color')), { target: { value: 'yellow' } });
  expect(getPrefs()).toMatchObject({ subtitleColor: 'yellow', castSubtitleDefaults: false });
  expect(screen.getByLabelText(t('subtitleStyle.castPreview')).firstElementChild).toHaveProperty('style.color', 'rgb(255, 225, 77)');
});

it('shows when account saving fails while retaining the local choice', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ subtitleStyle: null });
  vi.spyOn(api, 'put').mockRejectedValue(new Error('offline'));
  setPrefs({ subtitleColor: 'white', castSubtitleDefaults: true });
  const stop = syncSubtitlePrefs();
  try {
    render(<CastSubtitleSettings />);
    fireEvent.change(screen.getByLabelText(t('subtitleStyle.color')), { target: { value: 'yellow' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t('subtitleStyle.accountSaveFailed')));
    expect(getPrefs().subtitleColor).toBe('yellow');
  } finally {
    stop();
  }
});
