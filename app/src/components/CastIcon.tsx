import { ActivityIndicator, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CastButton, CastContext, useCastDevice } from 'react-native-google-cast';
import { openCastDialog } from '../lib/cast';
import { errorMessage } from '../lib/connection';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import { useCastStatus } from './CastStatus';
import { TV } from './screen';
import { dialog } from '../lib/dialog';

/**
 * Always there: opens the Chromecast list, which searches the network itself (and "stop casting"
 * while connected). The standard button only shows once a Chromecast was already found in the
 * background, which can take long or not happen at all. On Android the list opens through a native
 * cast button, so an invisible one stays here. Connected from the home screen, the next title that
 * is opened plays on the TV. Not on a TV itself (Android TV / Google TV): it plays there already.
 */
export function CastIcon(props: { size?: number; color?: string }) {
  return TV ? null : <CastButtonIcon {...props} />;
}

function CastButtonIcon({ size = 24, color = '#fff' }: { size?: number; color?: string }) {
  const { t } = useSession();
  const device = useCastDevice();
  const status = useCastStatus();
  return (
    <>
      <CastButton style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} importantForAccessibility="no-hide-descendants" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('player.cast')}
        accessibilityState={{ selected: device !== null, busy: status === 'connecting' }}
        onPress={() => void openCastDialog(() => CastContext.showCastDialog(), (e) => dialog.alert(t('player.castListFailed'), typeof e === 'string' ? t(e) : errorMessage(e, t)))}
        hitSlop={12}
        style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
      >
        {status === 'connecting' ? <ActivityIndicator color={colors.accent} style={{ width: size, height: size }} /> : <Feather name="cast" size={size} color={device || status === 'connected' ? colors.accent : color} />}
      </Pressable>
    </>
  );
}
