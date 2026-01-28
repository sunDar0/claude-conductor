import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Activity } from '../types';

type Theme = 'light' | 'dark' | 'system';

interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  taskModalId: string | null;
  activities: Activity[];
  wsConnected: boolean;

  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
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
      sidebarOpen: true,
      taskModalId: null,
      activities: [],
      wsConnected: false,

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      openTaskModal: (id) => set({ taskModalId: id }),
      closeTaskModal: () => set({ taskModalId: null }),
      addActivity: (activity) =>
        set((s) => ({ activities: [activity, ...s.activities].slice(0, 50) })),
      setWsConnected: (connected) => set({ wsConnected: connected }),
    }),
    {
      name: 'conductor-ui',
      partialize: (s) => ({ theme: s.theme, sidebarOpen: s.sidebarOpen }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    }
  )
);
