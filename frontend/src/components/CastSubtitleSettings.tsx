import { useT } from '../i18n';
import { CAST_SUBTITLE_DEFAULTS, setPrefs, usePrefs, useSubtitleStyleSaveFailed, type PlaybackPrefs } from '../lib/prefs';
import { subtitleLineStyle } from '../lib/subtitles';

export function CastSubtitleSettings() {
  const prefs = usePrefs();
  const saveFailed = useSubtitleStyleSaveFailed();
  const { t } = useT();
  const style = subtitleLineStyle(prefs.castSubtitleDefaults ? CAST_SUBTITLE_DEFAULTS : prefs);
  const choices = [
    ['subtitleSize', 'size', [['small', t('subtitleStyle.small')], ['medium', t('subtitleStyle.medium')], ['large', t('subtitleStyle.large')], ['xlarge', t('subtitleStyle.xlarge')]]],
    ['subtitleColor', 'color', [['white', t('subtitleStyle.white')], ['yellow', t('subtitleStyle.yellow')]]],
    ['subtitleBackground', 'background', [['none', t('subtitleStyle.none')], ['translucent', t('subtitleStyle.dimmed')], ['solid', t('subtitleStyle.solid')]]],
    ['subtitleEdge', 'edge', [['shadow', t('subtitleStyle.shadow')], ['outline', t('subtitleStyle.outline')], ['none', t('subtitleStyle.none')]]],
  ] as const;
  return (
    <div className="space-y-3">
      <label className="flex items-center justify-between gap-3 text-sm">
        {t('subtitleStyle.castDefault')}
        <input type="checkbox" checked={prefs.castSubtitleDefaults} onChange={(e) => setPrefs({ castSubtitleDefaults: e.target.checked })} />
      </label>
      <div className="flex h-28 items-end justify-center overflow-hidden rounded-lg bg-[linear-gradient(135deg,#3a3450,#1a1622_60%,#0c0a10)] px-[5%] pb-[5%] text-center" aria-label={t('subtitleStyle.castPreview')}>
        <span className="max-w-[90%]" style={{ ...style, fontSize: { small: '0.9rem', medium: '1.1rem', large: '1.3rem', xlarge: '1.5rem' }[prefs.castSubtitleDefaults ? 'medium' : prefs.subtitleSize] }}>{t('subtitleStyle.sample')}</span>
      </div>
      {choices.map(([key, label, options]) => (
        <label key={key} className="flex items-center justify-between gap-3 text-sm">
          {t(`subtitleStyle.${label}`)}
          <select className="input w-36" value={prefs[key]} onChange={(e) => setPrefs({ [key]: e.target.value } as Partial<PlaybackPrefs>)}>
            {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
      ))}
      {saveFailed && <p role="status" className="text-xs text-danger">{t('subtitleStyle.accountSaveFailed')}</p>}
      <p className="text-xs text-muted">{t('subtitleStyle.castHint')}</p>
    </div>
  );
}
