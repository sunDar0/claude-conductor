---
description: Start a task (READY -> IN_PROGRESS)
arguments:
  - name: task_id
    description: Task ID to start
    required: true
---

# Task Start

Starts a task in READY status.

## Execution Instructions

1. Look up task in `.claude/skills/task-management/SKILL.md`.
2. Check state transition rules in `.claude/skills/orchestrator/SKILL.md`.
3. Verify current status is READY.
4. If not READY, output error message.
5. Execute `task:transition` to change to IN_PROGRESS.
6. Execute "READY -> IN_PROGRESS" action from Orchestrator.

## Usage Examples

```
/project:task-start TASK-001
```

## Error Cases

### Task not in READY status
```
Cannot start task

Task {TASK-ID} current status: {current status}
Must be in READY status to start.
```
