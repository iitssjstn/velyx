import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import { requireNativeView } from 'expo';

export interface RemoteKeyEvent {
  nativeEvent: { keyCode: number; repeat: number };
}

/**
 * Holds the focus and passes the remote's keys on (Android key codes); Back goes through
 * BackHandler. Only on Android TV, where the module is part of the app.
 */
export const RemoteKeys = requireNativeView<ViewProps & { onKey: (e: RemoteKeyEvent) => void }>('VidaluneTv') as ComponentType<ViewProps & { onKey: (e: RemoteKeyEvent) => void }>;
