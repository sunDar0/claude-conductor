import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, GitBranch, Clock, Play, Trash2, Eye, EyeOff } from 'lucide-react';
import { Badge } from '../common/Badge';
import { useUIStore } from '../../store/uiStore';
import { useTaskStore } from '../../store/taskStore';
import { api } from '../../lib/api';
import { toast, useToastStore } from '../../store/toastStore';
import type { Task } from '../../types';
import { cn, formatRelativeTime } from '../../lib/utils';

const STATUS_COLORS = {
  BACKLOG: 'bg-gray-400',
  READY: 'bg-blue-500',
  IN_PROGRESS: 'bg-amber-500',
  REVIEW: 'bg-purple-500',
  DONE: 'bg-green-500',
  CLOSED: 'bg-gray-300',
};

const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

interface Props {
  task: Task;
  isDragging?: boolean;
}

export function TaskCard({ task, isDragging }: Props) {
  const openTaskModal = useUIStore((s) => s.openTaskModal);
  const hideTask = useTaskStore((s) => s.hideTask);
  const unhideTask = useTaskStore((s) => s.unhideTask);

  const isHidden = task.hidden;

  // Only allow dragging for BACKLOG, READY, DONE statuses
  const canDrag = task.status === 'BACKLOG' || task.status === 'READY' || task.status === 'DONE';

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: task.id,
    disabled: !canDrag,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleDeleteTask = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`"${task.title}" 태스크를 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/tasks/${task.id}`);
      toast.success('태스크가 삭제되었습니다.');
      // Refresh tasks
      const { useTaskStore } = await import('../../store/taskStore');
      useTaskStore.getState().fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    }
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

  const handleToggleHide = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isHidden) {
      unhideTask(task.id);
    } else {
      hideTask(task.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200/50 dark:border-gray-700/50',
        'hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all cursor-pointer',
        isDragging && 'opacity-50 shadow-lg scale-[1.02]'
      )}
      onClick={() => openTaskModal(task.id)}
    >
      {/* Header: Status dot + Priority badge + Actions */}
      <div className="flex items-center gap-2 mb-3">
        <div className={cn('w-2 h-2 rounded-full flex-shrink-0', STATUS_COLORS[task.status])} />
        <Badge className={cn('text-xs px-2 py-0.5 font-medium border-0', PRIORITY_COLORS[task.priority])}>
          {task.priority}
        </Badge>

        {/* Drag handle - subtle, visible on hover */}
        <button
          {...attributes}
          {...listeners}
          className={cn(
            'p-1 -ml-1 rounded-md transition-opacity cursor-grab active:cursor-grabbing',
            'opacity-0 group-hover:opacity-100 hover:bg-gray-100 dark:hover:bg-gray-700'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3.5 h-3.5 text-gray-400" />
        </button>

        {/* Action buttons - appear on hover */}
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {(task.status === 'BACKLOG' || task.status === 'READY' || task.status === 'DONE') && (
            <button
              onClick={handleToggleHide}
              className={cn(
                'p-2 rounded-lg transition-colors',
                isHidden
                  ? 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                  : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              )}
              title={isHidden ? '숨김 해제' : '숨기기'}
            >
              {isHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          )}
          {task.status === 'BACKLOG' && (
            <button
              onClick={handleDeleteTask}
              className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-colors"
              title="태스크 삭제"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {task.status === 'READY' && (
            <button
              onClick={handleRunTask}
              className="p-2 rounded-lg bg-green-500 hover:bg-green-600 text-white shadow-sm transition-colors"
              title="AI 작업 실행"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <h4 className="font-medium text-[15px] text-gray-900 dark:text-white mb-3 line-clamp-2 leading-snug">
        {task.title}
      </h4>

      {/* Footer: Branch + Time + Task ID */}
      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        {task.branch && (
          <div className="flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5" />
            <span className="truncate max-w-24 font-mono">{task.branch.replace('feature/', '')}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <Clock className="w-3.5 h-3.5" />
          <span>{formatRelativeTime(task.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}
