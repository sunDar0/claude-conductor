# Task Management Skill

## Purpose

Handles creation, retrieval, modification, deletion, and state management of tasks.

## Data Schema

### Task Object

```typescript
interface Task {
  id: string;                    // "TASK-001" format
  title: string;                 // Task title
  description: string;           // Detailed description (optional)
  status: TaskStatus;            // Current status
  priority: Priority;            // Priority level
  created_at: string;            // ISO8601 format
  updated_at: string;            // ISO8601 format
  started_at: string | null;     // Start time
  completed_at: string | null;   // Completion time
  branch: string | null;         // Git branch name
  context_file: string;          // Context file path
  changelog_versions: number[];  // CHANGELOG version list
  feedback_history: Feedback[];  // Feedback history
}

type TaskStatus = "BACKLOG" | "READY" | "IN_PROGRESS" | "REVIEW" | "DONE" | "CLOSED";
type Priority = "critical" | "high" | "medium" | "low";

interface Feedback {
  id: string;
  content: string;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
}
```

### Registry Structure

```typescript
interface TaskRegistry {
  version: string;      // "1.0.0"
  counter: number;      // Last used number
  tasks: {
    [taskId: string]: Task;
  };
}
```

## Operations

### task:create - Create Task

**Input**:
- `title` (required): Task title
- `description` (optional): Detailed description
- `priority` (optional, default: "medium"): Priority level

**Processing**:
1. Read `.claude/tasks/registry.json`
2. Increment `counter` by 1
3. Generate new ID: `TASK-{counter padded to 3 digits}` (e.g., TASK-001)
4. Create current time in ISO8601 format
5. Create Task object with status "READY"
6. Add new Task to `registry.tasks`
7. Save `registry.json`
8. Create `.claude/tasks/TASK-001/` directory
9. Create `.claude/tasks/TASK-001/context.md` file

**Output Format**:
```
Task created successfully

| Field | Value |
|-------|-------|
| ID | TASK-001 |
| Title | {title} |
| Priority | {priority emoji} {priority} |
| Status | READY |

To start: /project:task-start TASK-001
```

**Priority Emoji Mapping**:
- critical: Red circle
- high: Orange circle
- medium: Yellow circle
- low: Green circle

---

### task:list - List Tasks

**Input**:
- `status` (optional): Filter by status
- `priority` (optional): Filter by priority

**Processing**:
1. Read `.claude/tasks/registry.json`
2. Apply filters if provided
3. Group by status and output

---

### task:get - Get Task Details

**Input**:
- `task_id` (required): Task ID to retrieve

**Processing**:
1. Read `.claude/tasks/registry.json`
2. Find task by ID
3. Output detailed information or error

---

### task:transition - State Transition

**Input**:
- `task_id` (required): Task ID
- `target_state` (required): Target status
- `feedback` (optional): Feedback content (required for REVIEW -> IN_PROGRESS)

**Processing**:
1. Read `.claude/tasks/registry.json`
2. Find task by ID
3. Validate state transition (refer to Orchestrator Skill)
4. Update status and related fields
5. Save `registry.json`

**Status Emoji**:
- BACKLOG: Box emoji
- READY: Clipboard emoji
- IN_PROGRESS: Sync emoji
- REVIEW: Eyes emoji
- DONE: Check emoji
- CLOSED: Flag emoji
