import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { CloudError, type CloudAccount, type createCloud } from '../lib/cloud';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { qrMatrix, tvSignInUrl, type TvCode } from '../lib/tvSignIn';
import type { MessageKey } from '../lib/i18n';
import { Button, styles } from './ui';

/**
 * Signing in on a TV without typing: a code and a QR code (lib/tvSignIn.ts). Entered on vidalune.com/tv
 * by someone signed in, the TV gets that account. An expired code is replaced by a new one.
 */
export function TvCodeSignIn({ cloud, onSignedIn }: { cloud: ReturnType<typeof createCloud>; onSignedIn: (account: CloudAccount) => void }) {
  const { t } = useSession();
  const [code, setCode] = useState<TvCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A new code: on opening, when the shown one expired, or on request.
  const [round, setRound] = useState(0);
  // The latest callback, without asking for a new code when the screen draws again.
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (err: unknown) => setError(t(err instanceof CloudError ? (`cloud.${err.problem}` as MessageKey) : 'cloud.failed'));
    const ask = (c: TvCode) => {
      timer = setTimeout(async () => {
        try {
          const answer = await cloud.tvPoll(c.device);
          if (!alive) return;
          if ('token' in answer) return signedIn.current(answer);
          setError(null);
        } catch (err) {
          if (!alive) return;
          if (err instanceof CloudError && err.problem === 'expired') return setRound((n) => n + 1);
          // Not reachable for a moment: keep asking.
          fail(err);
        }
        ask(c);
      }, c.interval * 1000);
    };
    setCode(null);
    cloud
      .tvCode()
      .then((c) => {
        if (!alive) return;
        setCode(c);
        setError(null);
        ask(c);
      })
      .catch((err: unknown) => alive && fail(err));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [cloud, round, t]);

  const matrix = useMemo(() => (code ? qrMatrix(tvSignInUrl(code)) : null), [code]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 40, flexWrap: 'wrap' }}>
      <View style={{ width: 260, height: 260, borderRadius: radius.lg, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        {matrix ? <Qr matrix={matrix} size={220} /> : <ActivityIndicator color={colors.bg} size="large" />}
      </View>
      <View style={{ flex: 1, minWidth: 280, gap: 16 }}>
        <Text style={styles.title} accessibilityRole="header">{t('tv.title')}</Text>
        <Text style={styles.body}>{t('tv.scan', { url: code ? code.url.replace(/^https:\/\//, '') : 'vidalune.com/tv' })}</Text>
        <Text style={{ color: colors.ink, fontSize: 44, fontWeight: '800', letterSpacing: 6 }} accessibilityLabel={code?.code.split('').join(' ')}>{code?.code ?? '····-····'}</Text>
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : <Text style={styles.muted} accessibilityLiveRegion="polite">{code ? t('tv.waiting') : ' '}</Text>}
        {error && <Button label={t('tv.newCode')} variant="ghost" onPress={() => setRound((n) => n + 1)} />}
      </View>
    </View>
  );
}

/** A QR code drawn with views: per row, one view for each run of dark modules. */
function Qr({ matrix, size }: { matrix: boolean[][]; size: number }) {
  // Whole pixels per module: fractions leave thin lines between the rows.
  const cell = Math.max(1, Math.floor(size / matrix.length));
  return (
    <View style={{ width: cell * matrix.length, height: cell * matrix.length }} accessibilityLabel="QR">
      {matrix.map((row, r) => (
        <View key={r} style={{ height: cell, flexDirection: 'row' }}>
          {runs(row).map(([dark, length], i) => (
            <View key={i} style={{ width: cell * length, height: cell, backgroundColor: dark ? '#000' : 'transparent' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** [dark, length] for each stretch of the same colour in a row. */
function runs(row: boolean[]): [boolean, number][] {
  const out: [boolean, number][] = [];
  for (const dark of row) {
    const last = out[out.length - 1];
    if (last && last[0] === dark) last[1] += 1;
    else out.push([dark, 1]);
  }
  return out;
}
