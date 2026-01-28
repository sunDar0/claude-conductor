import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Activity } from '../types';

type Theme = 'light' | 'dark' | 'system';

interface UIState {
  theme: Theme;
  taskModalId: string | null;
  activities: Activity[];
  wsConnected: boolean;

  setTheme: (theme: Theme) => void;
  openTaskModal: (id: string) => void;
  closeTaskModal: () => void;
  addActivity: (activity: Activity) => void;
  setWsConnected: (connected: boolean) => void;
}

function applyTheme(theme: Theme) {
  const isDark = theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'system',
      taskModalId: null,
      activities: [],
      wsConnected: false,

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      openTaskModal: (id) => set({ taskModalId: id }),
      closeTaskModal: () => set({ taskModalId: null }),
      addActivity: (activity) =>
        set((s) => ({ activities: [activity, ...s.activities].slice(0, 50) })),
      setWsConnected: (connected) => set({ wsConnected: connected }),
    }),
    {
      name: 'conductor-ui',
      partialize: (s) => ({ theme: s.theme }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    }
  )
);
