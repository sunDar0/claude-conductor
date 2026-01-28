import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../../types';
import { cn } from '../../lib/utils';

interface Props {
  status: TaskStatus;
  title: string;
  color: string;
  tasks: Task[];
}

export function KanbanColumn({ status, title, color, tasks }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col w-72 min-w-72 rounded-xl bg-gray-100 dark:bg-gray-800',
        isOver && 'ring-2 ring-blue-500'
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <div className={cn('w-3 h-3 rounded-full', color)} />
        <h3 className="font-medium text-gray-900 dark:text-white">{title}</h3>
        <span className="ml-auto text-sm text-gray-500">{tasks.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="py-8 text-center text-gray-400 text-sm">No tasks</div>
        )}
      </div>
    </div>
  );
}
