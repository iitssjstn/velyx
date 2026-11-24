import { useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../lib/session';
import { TRAILER_ORIGIN, trailerEvent, trailerHtml, trailerPath, trailerUrl, type Trailer } from '../lib/trailer';
import { colors } from '../lib/theme';
import { Button } from './ui';

/**
 * "Trailer" next to Play, when the server knows one. It plays in a window over the page, inside the
 * app (as on the website): leaving for the YouTube app could make Android close Vidalune on a
 * Chromecast, so it started over when you came back. Back (or ✕ on a phone) closes the window; a
 * trailer YouTube does not allow in a window still opens in the YouTube app. `outsideLibrary`: a
 * title that is not in the library (its page from the catalog); `id` is its TMDB id.
 */
export function TrailerButton({ type, id, outsideLibrary = false }: { type: 'movie' | 'show'; id: number; outsideLibrary?: boolean }) {
  const { api, serverUrl, t } = useSession();
  const [open, setOpen] = useState(false);
  const path = trailerPath(type, id, outsideLibrary);
  const q = useQuery({
    queryKey: [serverUrl, 'trailer', path],
    queryFn: () => api.get<{ trailer: Trailer | null }>(path),
    staleTime: 3_600_000,
    retry: false,
  });
  const trailer = q.data?.trailer ?? null;
  const url = trailer ? trailerUrl(trailer) : null;
  const html = trailer ? trailerHtml(trailer) : null;
  if (!url || !html) return null;
  return (
    <>
      <Button label={t('detail.trailer')} variant="ghost" onPress={() => setOpen(true)} />
      {open && (
        <TrailerWindow
          html={html}
          label={t('common.close')}
          onClose={() => setOpen(false)}
          onFailed={() => {
            setOpen(false);
            void Linking.openURL(url);
          }}
        />
      )}
    </>
  );
}

function TrailerWindow({ html, label, onClose, onFailed }: { html: string; label: string; onClose: () => void; onFailed: () => void }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <WebView
          source={{ html, baseUrl: `${TRAILER_ORIGIN}/` }}
          originWhitelist={['https://*']}
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          // Nothing of the window is kept: no cookies or storage left behind by YouTube.
          incognito
          setSupportMultipleWindows={false}
          style={{ flex: 1, backgroundColor: '#000' }}
          onLoadEnd={() => setLoading(false)}
          onError={onFailed}
          onMessage={(e) => {
            const event = trailerEvent(e.nativeEvent.data);
            if (event === 'ended') onClose();
            else if (event === 'failed') onFailed();
          }}
          // Links in the player (the YouTube logo, "Watch on YouTube") open outside the window.
          onShouldStartLoadWithRequest={(r) => {
            if (r.isTopFrame === false || r.url.startsWith(TRAILER_ORIGIN) || /^(about|data):/.test(r.url)) return true;
            void Linking.openURL(r.url);
            return false;
          }}
        />
        {loading && <ActivityIndicator color={colors.accent} size="large" style={{ position: 'absolute', alignSelf: 'center', top: '45%' }} />}
        {/* On a TV, Back closes the window; a button there would only take the remote's focus. */}
        {!Platform.isTV && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={12}
            onPress={onClose}
            style={{ position: 'absolute', top: insets.top + 12, right: insets.right + 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Feather name="x" size={22} color={colors.ink} />
          </Pressable>
        )}
      </View>
    </Modal>
  );
}
