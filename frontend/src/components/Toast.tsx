import { useEffect, useState } from 'react';
import { CircleCheck, CircleAlert } from 'lucide-react';
import { errorMessage } from '../lib/api';

interface ToastItem {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(t: ToastItem[]) => void>();

function push(kind: ToastItem['kind'], message: string) {
  const item = { id: nextId++, kind, message };
  items = [...items, item];
  listeners.forEach((l) => l(items));
  setTimeout(() => {
    items = items.filter((i) => i.id !== item.id);
    listeners.forEach((l) => l(items));
  }, kind === 'error' ? 6000 : 3500);
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (err: unknown) => push('error', typeof err === 'string' ? err : errorMessage(err)),
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex max-w-sm flex-col gap-2" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-raised px-4 py-3 text-sm shadow-2xl">
          {t.kind === 'success' ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
