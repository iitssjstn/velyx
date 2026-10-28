import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Text } from 'react-native';
import { FocusPressable, OUTLINE_INK, buttonLook } from './ui';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/connection';
import type { ApiRequest } from '../lib/lists';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { dialog } from '../lib/dialog';

/** Sends a list or watched change, then loads everything from the server again (its answer counts). */
export function useServerAction() {
  const { api, serverUrl, t } = useSession();
  const qc = useQueryClient();
  return async (req: ApiRequest): Promise<boolean> => {
    try {
      if (req.method === 'POST') await api.post(req.path, req.body);
      else await api.del(req.path);
      return true;
    } catch (err) {
      dialog.alert(t('common.error'), errorMessage(err, t));
      return false;
    } finally {
      void qc.invalidateQueries({ queryKey: [serverUrl] });
    }
  };
}

type IconName = React.ComponentProps<typeof Feather>['name'];

/**
 * A button that switches something on or off (watchlist, favorite, watched). It changes at once;
 * when the server refuses, it goes back and says why.
 */
export function Toggle({ active, icon, text, label, activeLabel, request, compact }: { active: boolean; icon: IconName; text?: string; label: string; activeLabel: string; request: (on: boolean) => ApiRequest; compact?: boolean }) {
  const send = useServerAction();
  const [shown, setShown] = useState(active);
  const [busy, setBusy] = useState(false);
  // Follow the server once it has answered.
  useEffect(() => setShown(active), [active]);
  // Read aloud: what pressing does ("Add to watchlist" / "Remove from watchlist").
  const a11y = shown ? activeLabel : label;
  const tv = Platform.isTV;
  const ink = shown ? colors.buttonInk : OUTLINE_INK;
  return (
    <FocusPressable
      accessibilityRole="button"
      accessibilityState={{ selected: shown, busy }}
      accessibilityLabel={a11y}
      hitSlop={8}
      onPress={async () => {
        if (busy) return;
        const next = !shown;
        setShown(next);
        setBusy(true);
        const ok = await send(request(next));
        if (!ok) setShown(!next);
        setBusy(false);
      }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: compact ? 36 : 44,
          paddingHorizontal: compact ? 10 : 16,
          opacity: pressed ? 0.8 : 1,
        },
        // Filled when on, outlined when off (the buttons' look everywhere).
        shown ? buttonLook.filled : buttonLook.outlined,
        // On a TV a round icon as high as the other buttons, so all fit on one row; what it does is read aloud.
        // An outlined one gets a dark inside, so its icon shows on a bright photo too.
        tv && { height: 48, width: 48, paddingHorizontal: 0, justifyContent: 'center', borderRadius: radius.pill },
        tv && !shown && { backgroundColor: 'rgba(20,18,28,0.7)' },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={ink} /> : <Feather name={icon} size={compact ? 16 : 18} color={ink} />}
      {!compact && !tv && text ? <Text style={{ color: ink, fontWeight: '600' }}>{text}</Text> : null}
    </FocusPressable>
  );
}
