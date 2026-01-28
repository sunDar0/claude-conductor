---
description: Initialize Claude Conductor
---

# Conductor Init

Initializes Claude Conductor for the project.

## Execution Instructions

Perform initialization in the following order:

### 1. Check and Create Directory Structure

```bash
mkdir -p .claude/{skills/{orchestrator,task-management,code-review,changelog,dev-server,api-docs,dashboard},commands,tasks,servers}
```

### 2. Initialize Registry Files

If `.claude/tasks/registry.json` doesn't exist, create:
```json
{
  "version": "1.0.0",
  "counter": 0,
  "tasks": {}
}
```

If `.claude/servers/registry.json` doesn't exist, create:
```json
{
  "version": "1.0.0",
  "servers": {}
}
```

### 3. Output Initialization Complete Message

```
Claude Conductor initialized

Created structure:
.claude/
├── skills/          (7 Skill directories)
├── commands/        (Command definitions)
├── tasks/           (Task storage)
└── servers/         (Server info)

Available commands:
- /project:task-create "title" : Create new task
- /project:task-list          : List tasks
- /project:task-start ID      : Start task
- /project:task-get ID        : Get task details
```

## Usage Examples

```
/project:conductor-init
```
