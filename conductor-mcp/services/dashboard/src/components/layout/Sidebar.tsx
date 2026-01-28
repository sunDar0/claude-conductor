import { Activity, Cpu, LayoutGrid, Server, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';

type View = 'kanban' | 'servers' | 'agents' | 'activity';

interface Props {
  currentView: View;
  onViewChange: (view: View) => void;
}

const NAV_ITEMS = [
  { id: 'kanban' as View, label: 'Kanban Board', icon: LayoutGrid },
  { id: 'servers' as View, label: 'Servers', icon: Server },
  { id: 'agents' as View, label: 'Workers', icon: Cpu },
  { id: 'activity' as View, label: 'Activity', icon: Activity },
];

export function Sidebar({ currentView, onViewChange }: Props) {
  return (
    <aside className="w-56 border-r dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col">
      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors',
                currentView === item.id
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              )}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="p-4 border-t dark:border-gray-700">
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
          <Settings className="w-5 h-5" />
          Settings
        </button>
      </div>
    </aside>
  );
}
