import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import { NativeModule, requireNativeView, requireOptionalNativeModule } from 'expo';
import type { CastConnectLoad } from '../../src/lib/castConnect';

export interface RemoteKeyEvent {
  nativeEvent: { keyCode: number; repeat: number };
}

/**
 * Holds the focus and passes the remote's keys on (Android key codes); Back goes through
 * BackHandler. Only on Android TV, where the module is part of the app.
 */
export const RemoteKeys = requireNativeView<ViewProps & { onKey: (e: RemoteKeyEvent) => void }>('VidaluneTv') as ComponentType<ViewProps & { onKey: (e: RemoteKeyEvent) => void }>;

/** A sender's command to the player while it casts to this TV (seconds; track 0 is no subtitle). */
export type CastCommand = { type: 'play' | 'pause' | 'stop' } | { type: 'seek'; position: number } | { type: 'subtitle'; trackId: number };

declare class CastReceiverModule extends NativeModule<{ onCastLoad: (load: CastConnectLoad) => void; onCastCommand: (command: CastCommand) => void }> {
  /** The latest cast not opened yet (null: none). */
  takeCastLoad(): CastConnectLoad | null;
  castMedia(title: string, subtitle: string | null, image: string | null, duration: number, customData: string, tracks: { id: number; name: string; language: string | null }[]): Promise<void>;
  castStatus(state: 'playing' | 'paused' | 'buffering' | 'idle', position: number, trackIds: number[]): Promise<void>;
}

/** Cast Connect on a TV (CastConnect.kt): null where the module is not in the app (iOS). */
export const CastReceiver = requireOptionalNativeModule<CastReceiverModule>('VidaluneTv');
