/**
 * The app's own question and message boxes, in Vidalune's style instead of Android's: `dialog.alert`
 * takes what `Alert.alert` takes. One box at a time; the next waits until the shown one is closed.
 * `DialogHost` (components/Dialog.tsx) draws the first in line.
 */

export interface DialogButton {
  text: string;
  /** `cancel` is the outlined one that Back also presses; `destructive` is red. */
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
}

type Listener = (shown: DialogRequest | null) => void;

/** The text of the only button when none is given (as Android's own box). */
export const DEFAULT_OK = 'OK';

export function createDialogs() {
  let queue: DialogRequest[] = [];
  let next = 1;
  const listeners = new Set<Listener>();
  const notify = () => {
    for (const l of listeners) l(queue[0] ?? null);
  };
  return {
    alert(title: string, message?: string, buttons?: DialogButton[]): void {
      queue = [...queue, { id: next++, title, message, buttons: buttons?.length ? buttons : [{ text: DEFAULT_OK }] }];
      if (queue.length === 1) notify();
    },
    /** The box on screen now (null: none). */
    shown(): DialogRequest | null {
      return queue[0] ?? null;
    },
    /** Closes box `id` (the button pressed, if any); its action runs after the next box is up, so it can ask again. */
    close(id: number, button?: DialogButton): void {
      if (queue[0]?.id !== id) return;
      queue = queue.slice(1);
      notify();
      button?.onPress?.();
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** What Back does: press Cancel, or the only button there is; with more and no Cancel, the box stays. */
export function backButton(req: DialogRequest): DialogButton | null {
  return req.buttons.find((b) => b.style === 'cancel') ?? (req.buttons.length === 1 ? req.buttons[0]! : null);
}

/** The button that gets the focus on a TV and is drawn filled: the last that is not Cancel. */
export function mainButton(req: DialogRequest): DialogButton | null {
  return [...req.buttons].reverse().find((b) => b.style !== 'cancel') ?? null;
}

export const dialog = createDialogs();
