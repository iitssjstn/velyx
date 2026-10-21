export function showsSplash(playerState: string | null | undefined): boolean;
export function startOptions<T extends { touchScreenOptimizedApp?: boolean }>(UiConfig: new () => T): { uiConfig: T };
export function needsTracks(wanted: number[] | null | undefined, active: number[] | null | undefined, available: number[] | null | undefined): boolean;
