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
import { HiddenColumn } from './HiddenColumn';
import { TaskCard } from './TaskCard';
import { CreateTaskModal } from './CreateTaskModal';
import { useTaskStore } from '../../store/taskStore';
import type { Task, TaskStatus } from '../../types';

const COLUMNS: { id: TaskStatus; title: string; color: string; draggable: boolean }[] = [
  { id: 'BACKLOG', title: 'Backlog', color: 'bg-gray-500', draggable: true },
  { id: 'READY', title: 'Ready', color: 'bg-blue-500', draggable: true },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'bg-amber-500', draggable: false },
  { id: 'REVIEW', title: 'Review', color: 'bg-purple-500', draggable: false },
  { id: 'DONE', title: 'Done', color: 'bg-green-500', draggable: true },
];

// Valid drag-drop combinations: BACKLOG ↔ READY ↔ DONE
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  BACKLOG: ['READY', 'DONE'],
  READY: ['BACKLOG', 'DONE'],
  IN_PROGRESS: [], // Cannot drag
  REVIEW: [], // Cannot drag
  DONE: ['BACKLOG', 'READY'],
  CLOSED: [], // Cannot drag
};

export function KanbanBoard() {
  const tasks = useTaskStore((s) => s.tasks);
  const moveTask = useTaskStore((s) => s.moveTask);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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
      CLOSED: [],
    };

    Object.values(tasks).forEach((t) => {
      // Filter out hidden tasks from regular columns
      if (!t.hidden && grouped[t.status]) {
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

  const hiddenTasks = useMemo(() => {
    return Object.values(tasks).filter((t) => t.hidden);
  }, [tasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks[event.active.id as string];
    setActiveTask(task || null);
    setIsDragging(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    setIsDragging(false);
    const { active, over } = event;

    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as TaskStatus;
    const task = tasks[taskId];

    // Check if transition is valid
    if (task && task.status !== newStatus) {
      const validTargets = VALID_TRANSITIONS[task.status];
      if (validTargets.includes(newStatus)) {
        moveTask(taskId, newStatus);
      }
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
          {COLUMNS.map((col) => {
            // Determine if this column can accept drops when something is being dragged
            // Can accept drop if: there's an active task AND this column is a valid target
            const canAcceptDrop = activeTask
              ? VALID_TRANSITIONS[activeTask.status]?.includes(col.id) || col.id === activeTask.status
              : true;
            // Column is "disabled" for drop only when dragging AND can't accept the drop
            const isDropDisabled = isDragging && !canAcceptDrop;

            return (
              <KanbanColumn
                key={col.id}
                status={col.id}
                title={col.title}
                color={col.color}
                tasks={tasksByColumn[col.id]}
                disabled={isDropDisabled}
                isBeingDragged={isDragging}
                canDragFrom={col.draggable}
              />
            );
          })}

          {/* Hidden Column */}
          <HiddenColumn tasks={hiddenTasks} />
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
