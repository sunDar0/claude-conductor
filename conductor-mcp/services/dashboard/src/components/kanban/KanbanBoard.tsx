import { useMemo, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { CreateTaskModal } from './CreateTaskModal';
import { useTaskStore } from '../../store/taskStore';
import type { Task, TaskStatus } from '../../types';

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: 'BACKLOG', title: 'Backlog', color: 'bg-gray-500' },
  { id: 'READY', title: 'Ready', color: 'bg-blue-500' },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'bg-amber-500' },
  { id: 'REVIEW', title: 'Review', color: 'bg-purple-500' },
  { id: 'DONE', title: 'Done', color: 'bg-green-500' },
];

export function KanbanBoard() {
  const tasks = useTaskStore((s) => s.tasks);
  const moveTask = useTaskStore((s) => s.moveTask);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const tasksByColumn = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      BACKLOG: [],
      READY: [],
      IN_PROGRESS: [],
      REVIEW: [],
      DONE: [],
    };

    Object.values(tasks).forEach((t) => {
      if (grouped[t.status]) {
        grouped[t.status].push(t);
      }
    });

    // Sort by updated_at descending
    Object.keys(grouped).forEach((status) => {
      grouped[status as TaskStatus].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    });

    return grouped;
  }, [tasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks[event.active.id as string];
    setActiveTask(task || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;

    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as TaskStatus;
    const task = tasks[taskId];

    if (task && task.status !== newStatus && COLUMNS.some((c) => c.id === newStatus)) {
      moveTask(taskId, newStatus);
    }
  };

  return (
    <>
      {/* Header with Create Button */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Task</span>
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 h-[calc(100%-3rem)] overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              status={col.id}
              title={col.title}
              color={col.color}
              tasks={tasksByColumn[col.id]}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask && <TaskCard task={activeTask} isDragging />}
        </DragOverlay>
      </DndContext>

      {/* Create Task Modal */}
      <CreateTaskModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </>
  );
}
