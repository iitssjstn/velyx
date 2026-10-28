/**
 * Goes before every media file FFmpeg or FFprobe opens: only local files, so a file in a library
 * (a playlist, or a container pointing elsewhere) can never make the server fetch from the network.
 */
export const LOCAL_ONLY = ['-protocol_whitelist', 'file'] as const;
