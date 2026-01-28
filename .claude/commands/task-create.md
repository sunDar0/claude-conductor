---
description: Create a new development task
arguments:
  - name: title
    description: Task title
    required: true
  - name: --priority
    description: Priority (critical, high, medium, low)
    required: false
    default: medium
  - name: --description
    description: Task detailed description
    required: false
---

# Task Create

Creates a new development task.

## Execution Instructions

1. Refer to `task:create` operation in `.claude/skills/task-management/SKILL.md`.
2. Parse input arguments:
   - First argument: title (handle quoted strings)
   - --priority flag: priority level
   - --description flag: description
3. Execute `task:create` operation.
4. Output result in specified format.

## Usage Examples

```
/project:task-create "Implement login API"
/project:task-create "Bug fix" --priority high
/project:task-create "User registration" --priority critical --description "Include email verification"
```
