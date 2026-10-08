import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CastSubtitleSettings } from './CastSubtitleSettings';
import { getPrefs, setPrefs } from '../lib/prefs';
import { t } from '../i18n';

afterEach(cleanup);

it('previews the TV default and immediately saves a custom colour', () => {
  setPrefs({ castSubtitleDefaults: true });
  render(<CastSubtitleSettings />);
  expect(screen.getByLabelText(t('subtitleStyle.castPreview')).firstElementChild).toHaveProperty('style.color', 'rgb(255, 255, 255)');
  fireEvent.change(screen.getByLabelText(t('subtitleStyle.color')), { target: { value: 'yellow' } });
  expect(getPrefs()).toMatchObject({ subtitleColor: 'yellow', castSubtitleDefaults: false });
  expect(screen.getByLabelText(t('subtitleStyle.castPreview')).firstElementChild).toHaveProperty('style.color', 'rgb(255, 225, 77)');
});
