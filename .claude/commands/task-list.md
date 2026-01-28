---
description: List all tasks
arguments:
  - name: --status
    description: Filter by status
    required: false
  - name: --priority
    description: Filter by priority
    required: false
---

# Task List

Lists all tasks grouped by status.

## Execution Instructions

1. Refer to `task:list` operation in `.claude/skills/task-management/SKILL.md`.
2. Apply optional filters.
3. Output result in specified format.

## Usage Examples

```
/project:task-list
/project:task-list --status READY
/project:task-list --priority high
```
