import { create } from 'zustand';
import type { ToastKind } from '@willio/shared';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  text?: string;
  icon?: string;
  action?: { label: string; run: () => void };
  ttl: number;
}

interface ToastStore {
  toasts: Toast[];
  push(t: Omit<Toast, 'id' | 'ttl'> & { ttl?: number }): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    const ttl = t.ttl ?? (t.kind === 'error' ? 6000 : t.action ? 12000 : 4000);
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id, ttl }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  info: (title: string, text?: string) => useToasts.getState().push({ kind: 'info', title, text }),
  success: (title: string, text?: string) => useToasts.getState().push({ kind: 'success', title, text }),
  warn: (title: string, text?: string) => useToasts.getState().push({ kind: 'warn', title, text }),
  error: (title: string, text?: string) => useToasts.getState().push({ kind: 'error', title, text }),
  achievement: (title: string, text?: string, icon?: string) =>
    useToasts.getState().push({ kind: 'achievement', title, text, icon }),
};
