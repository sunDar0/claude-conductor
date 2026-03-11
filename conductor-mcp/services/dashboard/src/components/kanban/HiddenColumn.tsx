import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { TaskCard } from './TaskCard';
import type { Task } from '../../types';
import { cn } from '../../lib/utils';

interface Props {
  tasks: Task[];
}

export function HiddenColumn({ tasks }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Don't render if no hidden tasks
  if (tasks.length === 0) return null;

  return (
    <div
      className={cn(
        'flex flex-col w-72 min-w-72 rounded-xl bg-gray-500/30 dark:bg-gray-700/30 border-2 border-dashed border-gray-400 dark:border-gray-600'
      )}
    >
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-2 hover:bg-gray-400/20 dark:hover:bg-gray-600/20 transition-colors rounded-t-xl"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        )}
        <div className="w-3 h-3 rounded-full bg-gray-500" />
        <h3 className="font-medium text-gray-700 dark:text-gray-300">Hidden</h3>
        <span className="ml-auto text-sm text-gray-600 dark:text-gray-400 bg-gray-400/50 px-2 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
