import { requireOptionalNativeModule } from 'expo';

export interface Decoders {
  videoCodecs: string[];
  tenBitCodecs: string[];
  audioCodecs: string[];
  hdr: boolean;
}

const Native = requireOptionalNativeModule<{ decoders(): Decoders }>('VelyxCodecs');

/** What this device decodes (Android's decoder list), or null where the module is not available. */
export function deviceDecoders(): Decoders | null {
  try {
    return Native?.decoders() ?? null;
  } catch {
    return null;
  }
}
