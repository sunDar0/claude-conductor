import { create } from 'zustand';
import type { ToastType } from '../components/common/Toast';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (type: ToastType, message: string) => string;
  removeToast: (id: string) => void;
  updateToast: (id: string, type: ToastType, message: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type, message) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    set((state) => ({
      toasts: [...state.toasts, { id, type, message }],
    }));
    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  updateToast: (id, type, message) => {
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === id ? { ...t, type, message } : t
      ),
    }));
  },
}));

// Helper functions for easier usage
export const toast = {
  success: (message: string) => useToastStore.getState().addToast('success', message),
  error: (message: string) => useToastStore.getState().addToast('error', message),
  info: (message: string) => useToastStore.getState().addToast('info', message),
  loading: (message: string) => useToastStore.getState().addToast('loading', message),
  dismiss: (id: string) => useToastStore.getState().removeToast(id),
  update: (id: string, type: ToastType, message: string) =>
    useToastStore.getState().updateToast(id, type, message),
};
