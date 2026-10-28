import { useSyncExternalStore } from 'react';
import { Modal, Platform, Text, View } from 'react-native';
import { backButton, dialog, mainButton, type DialogButton } from '../lib/dialog';
import { colors, radius } from '../lib/theme';
import { buttonLook, FocusPressable, OUTLINE_INK, styles } from './ui';

/**
 * Draws the box `dialog.alert` asked for, in Vidalune's style: the main button filled grey-purple,
 * Cancel outlined, what removes something in red. On a TV the main button has the focus; Back
 * presses Cancel. Mounted once, at the root of the app.
 */
export function DialogHost() {
  const req = useSyncExternalStore(dialog.subscribe, dialog.shown);
  if (!req) return null;
  const main = mainButton(req);
  const back = backButton(req);
  const press = (b: DialogButton) => dialog.close(req.id, b);
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => back && press(back)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,9,14,0.7)', justifyContent: 'center', padding: 24 }}>
        <View
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 24, gap: 12, width: '100%', maxWidth: Platform.isTV ? 640 : 480, alignSelf: 'center' }}
        >
          <Text style={{ color: colors.ink, fontSize: Platform.isTV ? 24 : 20, fontWeight: '700' }}>{req.title}</Text>
          {req.message ? <Text style={[styles.body, { color: colors.muted }]}>{req.message}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            {req.buttons.map((b, i) => {
              const filled = b === main && b.style !== 'destructive';
              const ink = b.style === 'destructive' ? colors.danger : filled ? colors.buttonInk : OUTLINE_INK;
              return (
                <FocusPressable
                  key={`${req.id}-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={b.text}
                  hasTVPreferredFocus={b === (main ?? req.buttons[0])}
                  onPress={() => press(b)}
                  style={({ pressed }) => [
                    styles.button,
                    { height: 44, paddingHorizontal: 20 },
                    filled ? buttonLook.filled : buttonLook.outlined,
                    b.style === 'destructive' && { borderColor: colors.danger },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.buttonText, { color: ink, fontSize: 15 }]}>{b.text}</Text>
                </FocusPressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}
