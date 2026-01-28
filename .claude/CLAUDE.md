# Claude Conductor Project

## Overview

This project is Claude Conductor - an automated development orchestration system.
Claude Code manages the entire lifecycle of development tasks from creation, progress, review, to completion.

## Auto-Pilot Mode (IMPORTANT)

**세션 시작 시 자동으로 다음을 수행하세요:**

1. `task_list` MCP 도구로 READY 상태 태스크 확인
2. READY 태스크가 있으면:
   - `task_start`로 태스크 시작 (IN_PROGRESS로 전환)
   - 태스크 내용에 따라 작업 수행
   - 작업 완료 시 `task_transition`으로 REVIEW 상태로 전환
3. READY 태스크가 없으면 사용자 입력 대기

**n8n-like 자동화 워크플로우:**
```
대시보드에서 태스크 생성 (READY)
       ↓
Claude Code가 자동 감지 및 작업 시작 (IN_PROGRESS)
       ↓
작업 완료 후 검수 대기 (REVIEW)
       ↓
사용자 승인 (DONE → CLOSED)
```

## Project Structure

- `.claude/agents/`: Specialized Agent definitions for each role
- `.claude/skills/`: Specialized Skill definitions for each function
- `.claude/commands/`: Slash command definitions
- `.claude/tasks/`: Task data storage
- `.claude/servers/`: Running server information

## Core Rules

### Task State Flow

```
BACKLOG → READY → IN_PROGRESS → REVIEW ⇄ IN_PROGRESS
                                    ↓
                                  DONE → CLOSED
```

### State Definitions

| Status | Description |
|--------|-------------|
| BACKLOG | In backlog, not yet ready |
| READY | Created, waiting to start |
| IN_PROGRESS | Work in progress |
| REVIEW | Waiting for developer review |
| DONE | Review approved |
| CLOSED | Finalized/Cancelled |

### Command List

| Command | Description |
|---------|-------------|
| /project:autopilot | **Auto-pilot mode** - READY 태스크 자동 처리 |
| /project:task-create | Create new task |
| /project:task-list | List all tasks |
| /project:task-start | Start a task |
| /project:task-get | Get task details |
| /project:conductor-init | Initialize Conductor |

## Data File Locations

- Task Registry: `.claude/tasks/registry.json`
- Individual Task Context: `.claude/tasks/{TASK-ID}/context.md`
- Server Registry: `.claude/servers/registry.json`

## Agents Reference

Specialized agents for different roles:
- `code-agent`: Code implementation and writing
- `docs-agent`: Documentation and API docs
- `review-agent`: Code review and quality checks
- `security-agent`: Security vulnerability scanning
- `test-agent`: Test writing and execution

## Skills Reference

When working on tasks, refer to these Skills:
- `.claude/skills/task-management/SKILL.md`: Task CRUD operations
- `.claude/skills/orchestrator/SKILL.md`: State transition rules
