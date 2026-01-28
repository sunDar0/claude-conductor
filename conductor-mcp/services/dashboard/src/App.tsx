import { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { KanbanBoard } from './components/kanban/KanbanBoard';
import { TaskModal } from './components/kanban/TaskModal';
import { ServerPanel } from './components/server/ServerPanel';
import { ActivityFeed } from './components/activity/ActivityFeed';
import { AgentPanel } from './components/agent/AgentPanel';
import { ToastContainer } from './components/common/ToastContainer';
import { useWebSocket } from './hooks/useWebSocket';
import { useTaskStore } from './store/taskStore';
import { useServerStore } from './store/serverStore';
import { useProjectStore } from './store/projectStore';

type View = 'kanban' | 'servers' | 'agents' | 'activity';

export default function App() {
  const [view, setView] = useState<View>('kanban');
  const setProjectFilter = useTaskStore((s) => s.setProjectFilter);
  const fetchServers = useServerStore((s) => s.fetchServers);
  const currentProject = useProjectStore((s) => s.currentProject);

  useWebSocket();

  // Re-fetch tasks when currentProject changes (including initial load)
  useEffect(() => {
    if (currentProject) {
      setProjectFilter(currentProject.id);
    }
  }, [currentProject, setProjectFilter]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar currentView={view} onViewChange={setView} />
        <main className="flex-1 overflow-hidden p-4">
          {view === 'kanban' && <KanbanBoard />}
          {view === 'servers' && <ServerPanel />}
          {view === 'agents' && <AgentPanel />}
          {view === 'activity' && <ActivityFeed />}
        </main>
      </div>
      <TaskModal />
      <ToastContainer />
    </div>
  );
}
