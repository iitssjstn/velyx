import { Alert, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CastButton, CastContext, useCastDevice } from 'react-native-google-cast';
import { openCastDialog } from '../lib/cast';
import { errorMessage } from '../lib/connection';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

/**
 * Always there: opens the Chromecast list, which searches the network itself (and "stop casting"
 * while connected). The standard button only shows once a Chromecast was already found in the
 * background, which can take long or not happen at all. On Android the list opens through a native
 * cast button, so an invisible one stays here. Connected from the home screen, the next title that
 * is opened plays on the TV.
 */
export function CastIcon({ size = 24, color = '#fff' }: { size?: number; color?: string }) {
  const { t } = useSession();
  const device = useCastDevice();
  return (
    <>
      <CastButton style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} importantForAccessibility="no-hide-descendants" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('player.cast')}
        accessibilityState={{ selected: device !== null }}
        onPress={() => void openCastDialog(() => CastContext.showCastDialog(), (e) => Alert.alert(t('player.castListFailed'), typeof e === 'string' ? t(e) : errorMessage(e, t)))}
        hitSlop={12}
        style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
      >
        <Feather name="cast" size={size} color={device ? colors.accent : color} />
      </Pressable>
    </>
  );
}
