import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, GitBranch, Clock, Play } from 'lucide-react';
import { Badge } from '../common/Badge';
import { useUIStore } from '../../store/uiStore';
import { api } from '../../lib/api';
import { toast, useToastStore } from '../../store/toastStore';
import type { Task } from '../../types';
import { cn, formatRelativeTime } from '../../lib/utils';

const PRIORITY_COLORS = {
  low: 'bg-gray-400 text-gray-800',
  medium: 'bg-blue-400 text-blue-800',
  high: 'bg-orange-400 text-orange-800',
  critical: 'bg-red-500 text-white',
};

interface Props {
  task: Task;
  isDragging?: boolean;
}

export function TaskCard({ task, isDragging }: Props) {
  const openTaskModal = useUIStore((s) => s.openTaskModal);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleRunTask = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const toastId = toast.loading('AI 작업 시작 중...');
    // WebSocket task:started보다 먼저 등록해야 중복 토스트 방지
    useToastStore.getState().setPipelineToastId(toastId);
    try {
      await api.post(`/tasks/${task.id}/run`);
    } catch (err) {
      toast.update(toastId, 'error', err instanceof Error ? err.message : '작업 시작 실패');
      useToastStore.getState().setPipelineToastId(null);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-white dark:bg-gray-900 rounded-lg p-3 shadow-sm border border-gray-200 dark:border-gray-700',
        'hover:shadow-md transition-shadow cursor-pointer',
        isDragging && 'opacity-50 shadow-lg'
      )}
      onClick={() => openTaskModal(task.id)}
    >
      <div className="flex items-start gap-2 mb-2">
        <button
          {...attributes}
          {...listeners}
          className="p-1 -ml-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 cursor-grab"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4 text-gray-400" />
        </button>
        <Badge className={cn('text-xs', PRIORITY_COLORS[task.priority])}>
          {task.priority}
        </Badge>
        {task.status === 'READY' && (
          <button
            onClick={handleRunTask}
            className="p-1 rounded-full bg-green-500 hover:bg-green-600 text-white"
            title="AI 작업 실행"
          >
            <Play className="w-3 h-3" />
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400 font-mono">{task.id}</span>
      </div>
      <h4 className="font-medium text-gray-900 dark:text-white mb-2 line-clamp-2">
        {task.title}
      </h4>
      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        {task.branch && (
          <div className="flex items-center gap-1">
            <GitBranch className="w-3 h-3" />
            <span className="truncate max-w-20">{task.branch.replace('feature/', '')}</span>
          </div>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <Clock className="w-3 h-3" />
          <span>{formatRelativeTime(task.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}
