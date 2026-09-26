import { useRef, useState } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';
import { colors } from '../lib/theme';

/**
 * A seek bar that can be tapped or dragged. While dragging it shows where it will go (onScrub);
 * the actual seek happens once, on release (important for streams that restart on every seek).
 */
export function SeekBar({ position, duration, onScrub, onSeek, label }: { position: number; duration: number; onScrub: (t: number | null) => void; onSeek: (t: number) => void; label: string }) {
  const width = useRef(1);
  const [drag, setDrag] = useState<number | null>(null);
  const latest = useRef({ duration, onScrub, onSeek });
  latest.current = { duration, onScrub, onSeek };
  // The responder below is created once, so it reads the current duration through the ref.
  const at = (x: number) => Math.max(0, Math.min(1, x / width.current)) * latest.current.duration;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const t = at(e.nativeEvent.locationX);
        setDrag(t);
        latest.current.onScrub(t);
      },
      onPanResponderMove: (e) => {
        const t = at(e.nativeEvent.locationX);
        setDrag(t);
        latest.current.onScrub(t);
      },
      onPanResponderRelease: (e) => {
        const t = at(e.nativeEvent.locationX);
        setDrag(null);
        latest.current.onScrub(null);
        latest.current.onSeek(t);
      },
      onPanResponderTerminate: () => {
        setDrag(null);
        latest.current.onScrub(null);
      },
    }),
  ).current;

  const shown = drag ?? position;
  const fraction = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0;
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onSeek(Math.max(0, Math.min(duration, position + (e.nativeEvent.actionName === 'increment' ? 10 : -10))))}
      onLayout={(e: LayoutChangeEvent) => (width.current = Math.max(1, e.nativeEvent.layout.width))}
      style={{ height: 36, justifyContent: 'center' }}
      {...responder.panHandlers}
    >
      <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' }}>
        <View style={{ height: 4, borderRadius: 2, width: `${fraction * 100}%`, backgroundColor: colors.accent }} />
      </View>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: `${fraction * 100}%`, marginLeft: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent, transform: [{ scale: drag !== null ? 1.3 : 1 }] }}
      />
    </View>
  );
}
