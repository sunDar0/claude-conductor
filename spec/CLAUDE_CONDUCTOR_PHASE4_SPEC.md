# Claude Conductor - Phase 4 상세 구현 스펙

> **목표**: 실시간 대시보드 - React 칸반 보드, 서버 모니터링, WebSocket
> **예상 소요**: 2주
> **선행 조건**: Phase 3 완료

---

## 📋 구현 체크리스트

- [x] React + Vite 프로젝트 설정
- [x] 칸반 보드 (드래그 앤 드롭)
- [x] 서버 모니터링 패널
- [x] WebSocket 실시간 연결
- [x] 다크/라이트 테마
- [ ] ~~Docker 통합~~ (로컬 실행으로 변경)
- [x] **Auto-Pipeline** (2025-01-28 추가)
- [x] **실시간 Pipeline 출력** (2025-01-28 추가)
- [x] **Manual Trigger Workflow** (2025-01-28 추가)

---

## 기술 스택

| 항목 | 선택 | 근거 |
|------|------|------|
| 프레임워크 | React 18 + Vite | 빠른 HMR |
| 상태 관리 | Zustand | 경량, 단순 |
| 스타일링 | Tailwind CSS | 빠른 개발 |
| DnD | @dnd-kit | 접근성, React 18 |
| 아이콘 | Lucide React | 경량 |
| Markdown | react-markdown + remark-gfm | GFM 지원 |

---

## Auto-Pipeline 기능 (2025-01-28 추가)

### 개요

대시보드에서 "Run" 버튼을 클릭하면 Claude CLI가 자동으로 태스크를 처리합니다.

### 워크플로우

```
1. 대시보드: 태스크 카드에서 [▶ Run] 클릭
2. HTTP API: POST /tasks/{id}/run 호출
3. Auto-Pipeline: Claude CLI 프로세스 spawn
4. WebSocket: 실시간 출력 스트리밍 (pipeline:output)
5. 완료 시: 자동으로 REVIEW 상태로 전이
```

### WebSocket 이벤트

| 이벤트 | Payload | 설명 |
|--------|---------|------|
| `task:started` | `{ id: string }` | AI 작업 시작 |
| `pipeline:output` | `{ task_id, output }` | 실시간 출력 라인 |
| `task:review` | `{ id: string }` | 작업 완료, 검수 대기 |
| `pipeline:error` | `{ task_id, error }` | 오류 발생 |
| `pipeline:queued` | `{ queue_position }` | 대기열 추가 |

### 대시보드 UI

- **TaskCard**: READY 상태에서 [▶ Run] 버튼 표시
- **TaskModal**: IN_PROGRESS 상태에서 실시간 로그 표시
- **Live Output**: 최근 100줄, 자동 스크롤

### 파일 위치

- `services/conductor/src/handlers/auto-pipeline.ts`
- `services/conductor/src/http-server.ts` (POST /tasks/:id/run)
- `services/dashboard/src/store/taskStore.ts` (pipelineOutput 상태)
- `services/dashboard/src/components/kanban/TaskModal.tsx` (Live Output UI)

---

## 아키텍처

> **아키텍처 변경 (2025-01-28)**: Dashboard와 Conductor는 로컬 실행, Redis만 Docker

```
┌─────────────────────────────────────────────────────────┐
│                  React Dashboard (로컬)                  │
│  ┌───────────┐  ┌───────────┐  ┌───────────────────┐   │
│  │  Kanban   │  │  Server   │  │   Sub Agents      │   │
│  │   Board   │  │  Monitor  │  │   + Activity      │   │
│  └───────────┘  └───────────┘  └───────────────────┘   │
│                        │                                │
│                   Zustand Store                         │
└────────────────────────┼────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
     HTTP REST                      WebSocket
     (Port:3100)                    (Port:3100)
         │                               │
┌────────┴───────────────────────────────┴────────────────┐
│              Conductor MCP Server (로컬)                 │
│  ┌─────────────────────────────────────────────────────┐│
│  │  HTTP Server  │  MCP Server  │  Auto-Pipeline      ││
│  │  (REST API)   │  (stdio)     │  (Claude CLI)       ││
│  └─────────────────────────────────────────────────────┘│
│                         │                               │
│                    Redis (Docker)                       │
│                    Port:6379                            │
└─────────────────────────────────────────────────────────┘
```

---

## Step 1: 프로젝트 구조

```
services/dashboard/
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── index.html
├── Dockerfile
├── nginx.conf
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── types/
    │   └── index.ts
    ├── store/
    │   ├── taskStore.ts
    │   ├── serverStore.ts
    │   └── uiStore.ts
    ├── hooks/
    │   ├── useWebSocket.ts
    │   └── useApi.ts
    ├── components/
    │   ├── layout/
    │   │   ├── Header.tsx
    │   │   ├── Sidebar.tsx
    │   │   └── Layout.tsx
    │   ├── kanban/
    │   │   ├── KanbanBoard.tsx
    │   │   ├── KanbanColumn.tsx
    │   │   ├── TaskCard.tsx
    │   │   └── TaskModal.tsx
    │   ├── server/
    │   │   ├── ServerPanel.tsx
    │   │   ├── ServerCard.tsx
    │   │   └── LogViewer.tsx
    │   ├── activity/
    │   │   └── ActivityFeed.tsx
    │   └── common/
    │       ├── Badge.tsx
    │       ├── Button.tsx
    │       ├── Modal.tsx
    │       └── Spinner.tsx
    └── lib/
        ├── api.ts
        ├── websocket.ts
        └── utils.ts
```

---

## Step 2: 패키지 설정

### `package.json`

```json
{
  "name": "@conductor/dashboard",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.5.0",
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "lucide-react": "^0.312.0",
    "clsx": "^2.1.0",
    "date-fns": "^3.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.2.48",
    "@types/react-dom": "^18.2.18",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.33",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.3.3",
    "vite": "^5.0.12"
  }
}
```

### `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://conductor-mcp:3100', changeOrigin: true },
      '/ws': { target: 'ws://conductor-mcp:3100', ws: true },
    },
  },
});
```

### `tailwind.config.js`

```javascript
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        backlog: '#6B7280',
        ready: '#3B82F6',
        progress: '#F59E0B',
        review: '#8B5CF6',
        done: '#10B981',
      },
    },
  },
  plugins: [],
};
```

---

## Step 3: 타입 정의

### `src/types/index.ts`

```typescript
export type TaskStatus = 'BACKLOG' | 'READY' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type ServerStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  branch_name: string;
  context_file: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  related_files: string[];
}

export interface RunningServer {
  task_id: string;
  type: string;
  port: number;
  pid: number;
  status: ServerStatus;
  started_at: string;
  url: string;
  api_docs?: { swagger?: string; redoc?: string };
}

export interface Activity {
  id: string;
  type: string;
  task_id: string;
  message: string;
  timestamp: string;
}

export interface WSMessage {
  type: string;
  payload: any;
  timestamp: string;
}
```

---

## Step 4: Zustand 스토어

### `src/store/taskStore.ts`

```typescript
import { create } from 'zustand';
import type { Task, TaskStatus } from '../types';
import { api } from '../lib/api';

interface TaskState {
  tasks: Record<string, Task>;
  loading: boolean;
  error: string | null;
  
  fetchTasks: () => Promise<void>;
  updateTask: (task: Task) => void;
  moveTask: (taskId: string, newStatus: TaskStatus) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: {},
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true });
    try {
      const response = await api.get('/api/tasks');
      set({ tasks: response.data.tasks, loading: false });
    } catch (err) {
      set({ error: '태스크 조회 실패', loading: false });
    }
  },

  updateTask: (task) => {
    set((state) => ({
      tasks: { ...state.tasks, [task.id]: task },
    }));
  },

  moveTask: async (taskId, newStatus) => {
    const task = get().tasks[taskId];
    if (!task) return;

    // Optimistic update
    const prevStatus = task.status;
    set((s) => ({
      tasks: { ...s.tasks, [taskId]: { ...task, status: newStatus } },
    }));

    try {
      await api.post(`/api/tasks/${taskId}/transition`, { to_status: newStatus });
    } catch {
      // Rollback
      set((s) => ({
        tasks: { ...s.tasks, [taskId]: { ...task, status: prevStatus } },
      }));
    }
  },
}));
```

### `src/store/serverStore.ts`

```typescript
import { create } from 'zustand';
import type { RunningServer } from '../types';
import { api } from '../lib/api';

interface ServerState {
  servers: Record<string, RunningServer>;
  logs: Record<string, string[]>;
  selectedId: string | null;
  loading: boolean;

  fetchServers: () => Promise<void>;
  updateServer: (server: RunningServer) => void;
  removeServer: (taskId: string) => void;
  fetchLogs: (taskId: string) => Promise<void>;
  selectServer: (taskId: string | null) => void;
}

export const useServerStore = create<ServerState>((set) => ({
  servers: {},
  logs: {},
  selectedId: null,
  loading: false,

  fetchServers: async () => {
    set({ loading: true });
    try {
      const response = await api.get('/api/servers');
      set({ servers: response.data.servers, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  updateServer: (server) => {
    set((s) => ({ servers: { ...s.servers, [server.task_id]: server } }));
  },

  removeServer: (taskId) => {
    set((s) => {
      const { [taskId]: _, ...rest } = s.servers;
      return { servers: rest };
    });
  },

  fetchLogs: async (taskId) => {
    try {
      const response = await api.get(`/api/servers/${taskId}/logs`);
      set((s) => ({ logs: { ...s.logs, [taskId]: response.data.logs } }));
    } catch {}
  },

  selectServer: (taskId) => set({ selectedId: taskId }),
}));
```

### `src/store/uiStore.ts`

```typescript
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
    { name: 'conductor-ui', partialize: (s) => ({ theme: s.theme, sidebarOpen: s.sidebarOpen }) }
  )
);

function applyTheme(theme: Theme) {
  const isDark = theme === 'dark' || 
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}
```

---

## Step 5: API 및 WebSocket

### `src/lib/api.ts`

```typescript
const BASE_URL = '/api';

export const api = {
  async get<T = any>(path: string): Promise<{ data: T }> {
    const res = await fetch(`${BASE_URL}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json() };
  },

  async post<T = any>(path: string, body?: any): Promise<{ data: T }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json() };
  },
};
```

### `src/lib/websocket.ts`

```typescript
import type { WSMessage } from '../types';

type Handler = (msg: WSMessage) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private reconnectAttempts = 0;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}/ws`);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.notify({ type: 'pong', payload: { connected: true }, timestamp: new Date().toISOString() });
    };

    this.ws.onmessage = (e) => {
      try { this.notify(JSON.parse(e.data)); } catch {}
    };

    this.ws.onclose = () => {
      this.notify({ type: 'pong', payload: { connected: false }, timestamp: new Date().toISOString() });
      this.attemptReconnect();
    };
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }

  subscribe(handler: Handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private notify(msg: WSMessage) {
    this.handlers.forEach((h) => h(msg));
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= 5) return;
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), 1000 * Math.pow(2, this.reconnectAttempts - 1));
  }
}

export const wsClient = new WSClient();
```

### `src/hooks/useWebSocket.ts`

```typescript
import { useEffect } from 'react';
import { wsClient } from '../lib/websocket';
import { useTaskStore } from '../store/taskStore';
import { useServerStore } from '../store/serverStore';
import { useUIStore } from '../store/uiStore';

export function useWebSocket() {
  const updateTask = useTaskStore((s) => s.updateTask);
  const updateServer = useServerStore((s) => s.updateServer);
  const removeServer = useServerStore((s) => s.removeServer);
  const addActivity = useUIStore((s) => s.addActivity);
  const setWsConnected = useUIStore((s) => s.setWsConnected);

  useEffect(() => {
    wsClient.connect();

    const unsub = wsClient.subscribe((msg) => {
      switch (msg.type) {
        case 'task.update':
          updateTask(msg.payload);
          break;
        case 'server.update':
          if (msg.payload.status === 'stopped') {
            removeServer(msg.payload.task_id);
          } else {
            updateServer(msg.payload);
          }
          break;
        case 'activity':
          addActivity(msg.payload);
          break;
        case 'pong':
          setWsConnected(msg.payload.connected);
          break;
      }
    });

    return () => {
      unsub();
      wsClient.disconnect();
    };
  }, []);
}
```

---

## Step 6: 공통 컴포넌트

### `src/components/common/Badge.tsx`

```tsx
import { clsx } from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'outline';
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={clsx(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      variant === 'default' && 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
      variant === 'outline' && 'border border-gray-300 dark:border-gray-600',
      className
    )}>
      {children}
    </span>
  );
}
```

### `src/components/common/Button.tsx`

```tsx
import { clsx } from 'clsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({ children, variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center font-medium rounded-lg transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-offset-2',
        variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700',
        variant === 'secondary' && 'bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100',
        variant === 'ghost' && 'hover:bg-gray-100 dark:hover:bg-gray-800',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        size === 'sm' && 'px-2.5 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-6 py-3 text-base',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
```

### `src/components/common/Modal.tsx`

```tsx
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className={clsx(
          'relative bg-white dark:bg-gray-800 rounded-xl shadow-xl transform transition-all',
          size === 'sm' && 'max-w-sm w-full',
          size === 'md' && 'max-w-md w-full',
          size === 'lg' && 'max-w-2xl w-full'
        )}>
          {title && (
            <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
              <h3 className="text-lg font-semibold">{title}</h3>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
```

---

## Step 7: 칸반 보드 컴포넌트

### `src/components/kanban/KanbanBoard.tsx`

```tsx
import { useMemo, useState } from 'react';
import { DndContext, DragEndEvent, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { useTaskStore } from '../../store/taskStore';
import type { Task, TaskStatus } from '../../types';

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: 'BACKLOG', title: '백로그', color: 'bg-gray-500' },
  { id: 'READY', title: '준비', color: 'bg-blue-500' },
  { id: 'IN_PROGRESS', title: '진행 중', color: 'bg-amber-500' },
  { id: 'REVIEW', title: '리뷰', color: 'bg-purple-500' },
  { id: 'DONE', title: '완료', color: 'bg-green-500' },
];

export function KanbanBoard() {
  const tasks = useTaskStore((s) => s.tasks);
  const moveTask = useTaskStore((s) => s.moveTask);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const tasksByColumn = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = { BACKLOG: [], READY: [], IN_PROGRESS: [], REVIEW: [], DONE: [] };
    Object.values(tasks).forEach((t) => grouped[t.status].push(t));
    Object.keys(grouped).forEach((s) => 
      grouped[s as TaskStatus].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    );
    return grouped;
  }, [tasks]);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const newStatus = over.id as TaskStatus;
    const task = tasks[taskId];
    if (task && task.status !== newStatus) moveTask(taskId, newStatus);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveTask(tasks[e.active.id as string] || null)}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 h-full overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <KanbanColumn key={col.id} status={col.id} title={col.title} color={col.color} tasks={tasksByColumn[col.id]} />
        ))}
      </div>
      <DragOverlay>{activeTask && <TaskCard task={activeTask} isDragging />}</DragOverlay>
    </DndContext>
  );
}
```

### `src/components/kanban/KanbanColumn.tsx`

```tsx
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../../types';
import { clsx } from 'clsx';

interface Props {
  status: TaskStatus;
  title: string;
  color: string;
  tasks: Task[];
}

export function KanbanColumn({ status, title, color, tasks }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div ref={setNodeRef} className={clsx(
      'flex flex-col w-72 min-w-72 rounded-xl bg-gray-100 dark:bg-gray-800',
      isOver && 'ring-2 ring-blue-500'
    )}>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className={clsx('w-3 h-3 rounded-full', color)} />
        <h3 className="font-medium text-gray-900 dark:text-white">{title}</h3>
        <span className="ml-auto text-sm text-gray-500">{tasks.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => <TaskCard key={task.id} task={task} />)}
        </SortableContext>
        {tasks.length === 0 && <div className="py-8 text-center text-gray-400 text-sm">태스크 없음</div>}
      </div>
    </div>
  );
}
```

### `src/components/kanban/TaskCard.tsx`

```tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, GitBranch, Clock } from 'lucide-react';
import { Badge } from '../common/Badge';
import { useUIStore } from '../../store/uiStore';
import type { Task } from '../../types';
import { clsx } from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

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
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'bg-white dark:bg-gray-900 rounded-lg p-3 shadow-sm border border-gray-200 dark:border-gray-700',
        'hover:shadow-md transition-shadow cursor-pointer',
        isDragging && 'opacity-50 shadow-lg'
      )}
      onClick={() => openTaskModal(task.id)}
    >
      <div className="flex items-start gap-2 mb-2">
        <button {...attributes} {...listeners} className="p-1 -ml-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 cursor-grab" onClick={(e) => e.stopPropagation()}>
          <GripVertical className="w-4 h-4 text-gray-400" />
        </button>
        <Badge className={clsx('text-xs', PRIORITY_COLORS[task.priority])}>{task.priority}</Badge>
        <span className="ml-auto text-xs text-gray-400 font-mono">{task.id}</span>
      </div>
      <h4 className="font-medium text-gray-900 dark:text-white mb-2 line-clamp-2">{task.title}</h4>
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)}
          {task.tags.length > 3 && <Badge variant="outline" className="text-xs">+{task.tags.length - 3}</Badge>}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        {task.branch_name && (
          <div className="flex items-center gap-1">
            <GitBranch className="w-3 h-3" />
            <span className="truncate max-w-20">{task.branch_name.replace('feature/', '')}</span>
          </div>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <Clock className="w-3 h-3" />
          <span>{formatDistanceToNow(new Date(task.updated_at), { addSuffix: true, locale: ko })}</span>
        </div>
      </div>
    </div>
  );
}
```

---

## Step 8: 서버 모니터링 컴포넌트

### `src/components/server/ServerPanel.tsx`

```tsx
import { Server, RefreshCw } from 'lucide-react';
import { ServerCard } from './ServerCard';
import { LogViewer } from './LogViewer';
import { Button } from '../common/Button';
import { useServerStore } from '../../store/serverStore';

export function ServerPanel() {
  const servers = useServerStore((s) => s.servers);
  const selectedId = useServerStore((s) => s.selectedId);
  const loading = useServerStore((s) => s.loading);
  const fetchServers = useServerStore((s) => s.fetchServers);

  const serverList = Object.values(servers);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-gray-500" />
          <h2 className="font-semibold text-gray-900 dark:text-white">서버</h2>
          <span className="text-sm text-gray-500">({serverList.length})</span>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchServers} disabled={loading}>
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {serverList.length === 0 ? (
          <div className="text-center text-gray-400 py-8">실행 중인 서버 없음</div>
        ) : (
          serverList.map((server) => <ServerCard key={server.task_id} server={server} />)
        )}
      </div>

      {selectedId && (
        <div className="h-64 border-t dark:border-gray-700">
          <LogViewer taskId={selectedId} />
        </div>
      )}
    </div>
  );
}

function clsx(...args: (string | boolean | undefined)[]) {
  return args.filter(Boolean).join(' ');
}
```

### `src/components/server/ServerCard.tsx`

```tsx
import { Square, ExternalLink, FileText } from 'lucide-react';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { useServerStore } from '../../store/serverStore';
import type { RunningServer } from '../../types';
import { clsx } from 'clsx';

const STATUS_COLORS = {
  starting: 'text-yellow-500',
  running: 'text-green-500',
  stopping: 'text-orange-500',
  stopped: 'text-gray-500',
  error: 'text-red-500',
};

export function ServerCard({ server }: { server: RunningServer }) {
  const selectedId = useServerStore((s) => s.selectedId);
  const selectServer = useServerStore((s) => s.selectServer);
  const isSelected = selectedId === server.task_id;
  const isRunning = server.status === 'running';

  return (
    <div
      className={clsx(
        'rounded-lg border p-3 transition-colors cursor-pointer bg-white dark:bg-gray-900',
        isSelected ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
      )}
      onClick={() => selectServer(isSelected ? null : server.task_id)}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={clsx('w-2 h-2 rounded-full', isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400')} />
          <span className="font-medium text-gray-900 dark:text-white">{server.task_id}</span>
        </div>
        <Badge variant="outline" className="text-xs">{server.type}</Badge>
      </div>

      <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
        <div className="flex justify-between"><span>포트</span><code className="text-blue-600">{server.port}</code></div>
        <div className="flex justify-between"><span>PID</span><code>{server.pid}</code></div>
        <div className="flex justify-between"><span>상태</span><span className={clsx('font-medium', STATUS_COLORS[server.status])}>{server.status}</span></div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t dark:border-gray-700">
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); window.open(server.url, '_blank'); }} disabled={!isRunning}>
          <ExternalLink className="w-4 h-4 mr-1" />열기
        </Button>
        {server.api_docs?.swagger && (
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); window.open(`${server.url}${server.api_docs!.swagger}`, '_blank'); }} disabled={!isRunning}>
            <FileText className="w-4 h-4 mr-1" />API
          </Button>
        )}
        {isRunning && (
          <Button variant="danger" size="sm" className="ml-auto" onClick={(e) => e.stopPropagation()}>
            <Square className="w-4 h-4 mr-1" />중지
          </Button>
        )}
      </div>
    </div>
  );
}
```

---

## Step 9: 레이아웃 및 App

### `src/components/layout/Header.tsx`

```tsx
import { Sun, Moon, Monitor, Wifi, WifiOff } from 'lucide-react';
import { Button } from '../common/Button';
import { useUIStore } from '../../store/uiStore';
import { clsx } from 'clsx';

export function Header() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const wsConnected = useUIStore((s) => s.wsConnected);

  const icons = { light: Sun, dark: Moon, system: Monitor };
  const next = { light: 'dark', dark: 'system', system: 'light' } as const;
  const Icon = icons[theme];

  return (
    <header className="h-14 border-b dark:border-gray-700 bg-white dark:bg-gray-800 px-4">
      <div className="h-full flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">C</div>
          <div>
            <h1 className="font-semibold text-gray-900 dark:text-white">Claude Conductor</h1>
            <p className="text-xs text-gray-500">Development Orchestrator</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={clsx('flex items-center gap-1.5 text-sm', wsConnected ? 'text-green-500' : 'text-red-500')}>
            {wsConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            <span className="hidden sm:inline">{wsConnected ? '연결됨' : '연결 끊김'}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setTheme(next[theme])}>
            <Icon className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
```

### `src/App.tsx`

```tsx
import { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { KanbanBoard } from './components/kanban/KanbanBoard';
import { ServerPanel } from './components/server/ServerPanel';
import { useWebSocket } from './hooks/useWebSocket';
import { useTaskStore } from './store/taskStore';
import { useServerStore } from './store/serverStore';

export default function App() {
  const [view, setView] = useState<'kanban' | 'servers'>('kanban');
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const fetchServers = useServerStore((s) => s.fetchServers);

  useWebSocket();

  useEffect(() => {
    fetchTasks();
    fetchServers();
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-56 border-r dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <nav className="space-y-1">
            <button onClick={() => setView('kanban')} className={`w-full text-left px-3 py-2 rounded-lg ${view === 'kanban' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              📋 칸반 보드
            </button>
            <button onClick={() => setView('servers')} className={`w-full text-left px-3 py-2 rounded-lg ${view === 'servers' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              🖥️ 서버
            </button>
          </nav>
        </aside>
        <main className="flex-1 overflow-hidden p-4">
          {view === 'kanban' && <KanbanBoard />}
          {view === 'servers' && <ServerPanel />}
        </main>
      </div>
    </div>
  );
}
```

### `src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### `src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
.dark ::-webkit-scrollbar-thumb { background: #475569; }
.line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
```

---

## Step 10: Docker 설정

### `Dockerfile`

```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### `nginx.conf`

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / { try_files $uri $uri/ /index.html; }
    location /api { proxy_pass http://conductor-mcp:3100; proxy_http_version 1.1; proxy_set_header Host $host; }
    location /ws { proxy_pass http://conductor-mcp:3100; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "Upgrade"; }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
```

### `docker-compose.yml` (업데이트)

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: [redis_data:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  conductor-mcp:
    build: ./services/conductor
    ports: ["3100:3100"]
    environment:
      - REDIS_URL=redis://redis:6379
      - WORKSPACE_DIR=/workspace
      - DATA_DIR=/data/conductor
    volumes:
      - ${WORKSPACE_PATH:-./workspace}:/workspace
      - conductor_data:/data/conductor
    depends_on:
      redis: { condition: service_healthy }

  dashboard:
    build: ./services/dashboard
    ports: ["4000:80"]
    depends_on: [conductor-mcp]

volumes:
  redis_data:
  conductor_data:
```

---

## Step 11: CHANGELOG 뷰어 (신규)

### `src/components/changelog/ChangelogViewer.tsx`

```tsx
import { useState, useEffect } from 'react';
import { FileText, ChevronDown, ChevronRight, Calendar, Tag } from 'lucide-react';
import { Badge } from '../common/Badge';
import { api } from '../../lib/api';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface ChangelogEntry {
  version: string;
  date: string;
  task_id: string;
  changes: {
    type: 'added' | 'changed' | 'fixed' | 'removed' | 'security';
    description: string;
  }[];
}

const TYPE_COLORS = {
  added: 'bg-green-100 text-green-800',
  changed: 'bg-blue-100 text-blue-800',
  fixed: 'bg-yellow-100 text-yellow-800',
  removed: 'bg-red-100 text-red-800',
  security: 'bg-purple-100 text-purple-800',
};

const TYPE_LABELS = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
  removed: 'Removed',
  security: 'Security',
};

export function ChangelogViewer() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChangelog();
  }, []);

  const fetchChangelog = async () => {
    try {
      const response = await api.get('/api/changelog');
      setEntries(response.data.entries);
      // 최신 버전은 기본 펼침
      if (response.data.entries.length > 0) {
        setExpandedVersions(new Set([response.data.entries[0].version]));
      }
    } catch (error) {
      console.error('Failed to fetch changelog:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleVersion = (version: string) => {
    const newSet = new Set(expandedVersions);
    if (newSet.has(version)) {
      newSet.delete(version);
    } else {
      newSet.add(version);
    }
    setExpandedVersions(newSet);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <FileText className="w-12 h-12 mb-2" />
        <p>변경 이력이 없습니다</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 mb-6">
        <FileText className="w-5 h-5 text-blue-500" />
        <h2 className="text-lg font-semibold">CHANGELOG</h2>
        <Badge variant="outline">{entries.length} versions</Badge>
      </div>

      {entries.map((entry) => {
        const isExpanded = expandedVersions.has(entry.version);
        return (
          <div
            key={entry.version}
            className="border dark:border-gray-700 rounded-lg overflow-hidden"
          >
            <button
              onClick={() => toggleVersion(entry.version)}
              className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                <Tag className="w-4 h-4 text-blue-500" />
                <span className="font-mono font-semibold">v{entry.version}</span>
                <Badge variant="outline" className="text-xs">
                  {entry.task_id}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Calendar className="w-4 h-4" />
                <span>{formatDistanceToNow(new Date(entry.date), { addSuffix: true, locale: ko })}</span>
              </div>
            </button>

            {isExpanded && (
              <div className="p-4 space-y-3 bg-white dark:bg-gray-900">
                {Object.entries(
                  entry.changes.reduce((acc, change) => {
                    if (!acc[change.type]) acc[change.type] = [];
                    acc[change.type].push(change.description);
                    return acc;
                  }, {} as Record<string, string[]>)
                ).map(([type, descriptions]) => (
                  <div key={type}>
                    <Badge className={TYPE_COLORS[type as keyof typeof TYPE_COLORS]}>
                      {TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
                    </Badge>
                    <ul className="mt-2 space-y-1 pl-4">
                      {descriptions.map((desc, i) => (
                        <li key={i} className="text-sm text-gray-700 dark:text-gray-300 list-disc">
                          {desc}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

---

## Step 12: Review 승인/반려 UI (신규)

### `src/components/kanban/TaskModal.tsx` (확장)

```tsx
import { useState } from 'react';
import { X, GitBranch, Clock, MessageSquare, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { api } from '../../lib/api';
import type { Task } from '../../types';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

export function TaskModal() {
  const taskModalId = useUIStore((s) => s.taskModalId);
  const closeTaskModal = useUIStore((s) => s.closeTaskModal);
  const tasks = useTaskStore((s) => s.tasks);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const task = taskModalId ? tasks[taskModalId] : null;

  if (!task) return null;

  const isReviewState = task.status === 'REVIEW';

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const response = await api.post(`/api/tasks/${task.id}/approve`, {
        feedback: feedback || undefined,
      });
      updateTask(response.data.task);
      closeTaskModal();
    } catch (error) {
      console.error('Approve failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!feedback.trim()) {
      alert('반려 사유를 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.post(`/api/tasks/${task.id}/reject`, {
        feedback,
      });
      updateTask(response.data.task);
      closeTaskModal();
    } catch (error) {
      console.error('Reject failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={!!taskModalId} onClose={closeTaskModal} title={task.title} size="lg">
      <div className="space-y-4">
        {/* 상태 및 우선순위 */}
        <div className="flex items-center gap-2">
          <Badge>{task.status}</Badge>
          <Badge variant="outline">{task.priority}</Badge>
          <span className="text-sm text-gray-500 ml-auto">
            {task.id}
          </span>
        </div>

        {/* 설명 */}
        {task.description && (
          <div className="prose dark:prose-invert text-sm">
            <p>{task.description}</p>
          </div>
        )}

        {/* 메타 정보 */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          {task.branch_name && (
            <div className="flex items-center gap-2 text-gray-500">
              <GitBranch className="w-4 h-4" />
              <code>{task.branch_name}</code>
            </div>
          )}
          <div className="flex items-center gap-2 text-gray-500">
            <Clock className="w-4 h-4" />
            <span>
              {formatDistanceToNow(new Date(task.updated_at), { addSuffix: true, locale: ko })}
            </span>
          </div>
        </div>

        {/* 리뷰 상태일 때 승인/반려 UI */}
        {isReviewState && (
          <div className="border-t dark:border-gray-700 pt-4 mt-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-purple-500" />
              <span className="font-medium">개발자 리뷰 대기 중</span>
            </div>

            {/* 피드백 입력 */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">
                <MessageSquare className="w-4 h-4 inline mr-1" />
                피드백 (반려 시 필수)
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="피드백을 입력하세요..."
                className="w-full h-24 px-3 py-2 border dark:border-gray-700 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-gray-800"
              />
            </div>

            {/* 승인/반려 버튼 */}
            <div className="flex gap-3">
              <Button
                variant="primary"
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleApprove}
                disabled={submitting}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                승인 (DONE 이동)
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={handleReject}
                disabled={submitting}
              >
                <XCircle className="w-4 h-4 mr-2" />
                반려 (IN_PROGRESS 이동)
              </Button>
            </div>
          </div>
        )}

        {/* 피드백 이력 */}
        {task.feedback_history && task.feedback_history.length > 0 && (
          <div className="border-t dark:border-gray-700 pt-4">
            <h4 className="font-medium mb-2">피드백 이력</h4>
            <div className="space-y-2">
              {task.feedback_history.map((fb: any, i: number) => (
                <div
                  key={i}
                  className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm"
                >
                  <p>{fb.content}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDistanceToNow(new Date(fb.created_at), { addSuffix: true, locale: ko })}
                    {fb.resolved && ' • 해결됨'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
```

---

## Step 13: 토스트 알림 시스템 (신규)

### `src/components/common/Toast.tsx`

```tsx
import { useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { clsx } from 'clsx';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastData;
  onClose: (id: string) => void;
}

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

const COLORS = {
  success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200',
  error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-200',
  info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200',
};

export function Toast({ toast, onClose }: ToastProps) {
  const Icon = ICONS[toast.type];

  useEffect(() => {
    if (toast.duration !== 0) {
      const timer = setTimeout(() => {
        onClose(toast.id);
      }, toast.duration || 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, onClose]);

  return (
    <div
      className={clsx(
        'flex items-start gap-3 p-4 rounded-lg border shadow-lg animate-slide-in',
        COLORS[toast.type]
      )}
    >
      <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{toast.title}</p>
        {toast.message && (
          <p className="text-sm opacity-80 mt-0.5">{toast.message}</p>
        )}
      </div>
      <button
        onClick={() => onClose(toast.id)}
        className="flex-shrink-0 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
```

### `src/components/common/ToastContainer.tsx`

```tsx
import { Toast } from './Toast';
import { useUIStore } from '../../store/uiStore';

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onClose={removeToast} />
      ))}
    </div>
  );
}
```

### `src/store/uiStore.ts` (확장)

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ToastData, ToastType } from '../components/common/Toast';

interface UIState {
  // 기존 상태...
  theme: 'light' | 'dark' | 'system';
  sidebarOpen: boolean;
  taskModalId: string | null;
  wsConnected: boolean;

  // 토스트 상태 추가
  toasts: ToastData[];

  // 기존 액션...
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleSidebar: () => void;
  openTaskModal: (id: string) => void;
  closeTaskModal: () => void;
  setWsConnected: (connected: boolean) => void;

  // 토스트 액션 추가
  addToast: (toast: Omit<ToastData, 'id'>) => void;
  removeToast: (id: string) => void;
  showSuccess: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
  showWarning: (title: string, message?: string) => void;
  showInfo: (title: string, message?: string) => void;
}

let toastCounter = 0;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarOpen: true,
      taskModalId: null,
      wsConnected: false,
      toasts: [],

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      openTaskModal: (id) => set({ taskModalId: id }),
      closeTaskModal: () => set({ taskModalId: null }),
      setWsConnected: (connected) => set({ wsConnected: connected }),

      addToast: (toast) => {
        const id = `toast-${++toastCounter}`;
        set((s) => ({
          toasts: [...s.toasts, { ...toast, id }].slice(-5), // 최대 5개
        }));
      },

      removeToast: (id) => {
        set((s) => ({
          toasts: s.toasts.filter((t) => t.id !== id),
        }));
      },

      showSuccess: (title, message) => {
        set((s) => {
          const id = `toast-${++toastCounter}`;
          return {
            toasts: [...s.toasts, { id, type: 'success', title, message }].slice(-5),
          };
        });
      },

      showError: (title, message) => {
        set((s) => {
          const id = `toast-${++toastCounter}`;
          return {
            toasts: [...s.toasts, { id, type: 'error', title, message }].slice(-5),
          };
        });
      },

      showWarning: (title, message) => {
        set((s) => {
          const id = `toast-${++toastCounter}`;
          return {
            toasts: [...s.toasts, { id, type: 'warning', title, message }].slice(-5),
          };
        });
      },

      showInfo: (title, message) => {
        set((s) => {
          const id = `toast-${++toastCounter}`;
          return {
            toasts: [...s.toasts, { id, type: 'info', title, message }].slice(-5),
          };
        });
      },
    }),
    {
      name: 'conductor-ui',
      partialize: (s) => ({ theme: s.theme, sidebarOpen: s.sidebarOpen }),
    }
  )
);
```

### `src/hooks/useWebSocket.ts` (확장 - 토스트 연동)

```typescript
import { useEffect } from 'react';
import { wsClient } from '../lib/websocket';
import { useTaskStore } from '../store/taskStore';
import { useServerStore } from '../store/serverStore';
import { useUIStore } from '../store/uiStore';

export function useWebSocket() {
  const updateTask = useTaskStore((s) => s.updateTask);
  const updateServer = useServerStore((s) => s.updateServer);
  const removeServer = useServerStore((s) => s.removeServer);
  const setWsConnected = useUIStore((s) => s.setWsConnected);
  const showSuccess = useUIStore((s) => s.showSuccess);
  const showInfo = useUIStore((s) => s.showInfo);
  const showWarning = useUIStore((s) => s.showWarning);

  useEffect(() => {
    wsClient.connect();

    const unsub = wsClient.subscribe((msg) => {
      switch (msg.type) {
        case 'task.created':
          updateTask(msg.payload);
          showSuccess('태스크 생성', `${msg.payload.id}: ${msg.payload.title}`);
          break;

        case 'task.update':
          updateTask(msg.payload);
          showInfo('태스크 업데이트', `${msg.payload.id} → ${msg.payload.status}`);
          break;

        case 'task.transition':
          updateTask(msg.payload.task);
          showInfo('상태 변경', `${msg.payload.task.id}: ${msg.payload.from} → ${msg.payload.to}`);
          break;

        case 'review.approved':
          updateTask(msg.payload.task);
          showSuccess('리뷰 승인', `${msg.payload.task.id} 승인됨`);
          break;

        case 'review.rejected':
          updateTask(msg.payload.task);
          showWarning('리뷰 반려', `${msg.payload.task.id} 반려됨`);
          break;

        case 'server.update':
          if (msg.payload.status === 'stopped') {
            removeServer(msg.payload.task_id);
            showInfo('서버 중지', `${msg.payload.task_id} 서버 중지됨`);
          } else {
            updateServer(msg.payload);
            if (msg.payload.status === 'running') {
              showSuccess('서버 시작', `Port ${msg.payload.port}에서 실행 중`);
            }
          }
          break;

        case 'pong':
          setWsConnected(msg.payload.connected);
          break;
      }
    });

    return () => {
      unsub();
      wsClient.disconnect();
    };
  }, []);
}
```

### `src/index.css` (토스트 애니메이션 추가)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* 기존 스타일... */

/* 토스트 애니메이션 */
@keyframes slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.animate-slide-in {
  animation: slide-in 0.3s ease-out;
}
```

### `src/App.tsx` (ToastContainer 추가)

```tsx
import { ToastContainer } from './components/common/ToastContainer';
// ... 기존 import

export default function App() {
  // ... 기존 코드

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        {/* ... 기존 레이아웃 */}
      </div>
      <ToastContainer />
    </div>
  );
}
```

---

## 검증 테스트

| 테스트 | 명령 | 예상 결과 |
|--------|------|----------|
| 서비스 시작 | `docker-compose up -d` | 3개 컨테이너 실행 |
| 대시보드 접근 | `open http://localhost:4000` | 칸반 보드 표시 |
| 드래그 앤 드롭 | 카드 드래그 | 상태 변경, Optimistic UI |
| 실시간 업데이트 | MCP로 태스크 생성 | 대시보드에 즉시 반영 |
| 테마 전환 | 버튼 클릭 | 다크/라이트 전환 |
| **CHANGELOG 뷰어** | CHANGELOG 탭 클릭 | 버전별 변경사항 표시 |
| **리뷰 승인/반려** | REVIEW 상태 카드 클릭 | 승인/반려 버튼, 피드백 입력 |
| **토스트 알림** | 태스크 생성 | 우측 하단 토스트 표시 |

---

## 파일 체크리스트

| 파일 | 상태 | 설명 |
|------|:----:|------|
| `package.json` | NEW | |
| `vite.config.ts` | NEW | |
| `tailwind.config.js` | NEW | |
| `tsconfig.json` | NEW | |
| `index.html` | NEW | |
| `Dockerfile` | NEW | |
| `nginx.conf` | NEW | |
| `src/types/index.ts` | NEW | |
| `src/store/*.ts` (3) | NEW → UPDATE | uiStore에 토스트 추가 |
| `src/hooks/*.ts` (2) | NEW → UPDATE | useWebSocket 토스트 연동 |
| `src/lib/*.ts` (3) | NEW | |
| `src/components/**/*.tsx` (12+) | NEW | |
| `src/App.tsx` | NEW → UPDATE | ToastContainer 추가 |
| `src/main.tsx` | NEW | |
| `src/index.css` | NEW → UPDATE | 토스트 애니메이션 |
| `src/components/changelog/ChangelogViewer.tsx` | **NEW** | CHANGELOG 뷰어 |
| `src/components/kanban/TaskModal.tsx` | **NEW** | Review 승인/반려 UI |
| `src/components/common/Toast.tsx` | **NEW** | 토스트 컴포넌트 |
| `src/components/common/ToastContainer.tsx` | **NEW** | 토스트 컨테이너 |

---

*Phase 4 상세 스펙 문서 끝*
*다음: Phase 5 - 폴리싱 및 배포*
