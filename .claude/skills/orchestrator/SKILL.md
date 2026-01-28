# Orchestrator Skill

## Purpose

Defines task state transition rules and manages actions to execute during transitions.

## State Transition Rules

### Allowed Transitions

| Current Status | Allowed Next Status | Condition |
|----------------|---------------------|-----------|
| BACKLOG | READY | None |
| BACKLOG | CLOSED | None |
| READY | IN_PROGRESS | None |
| READY | BACKLOG | None |
| READY | CLOSED | None |
| IN_PROGRESS | REVIEW | None (Phase 2: test pass required) |
| IN_PROGRESS | CLOSED | None |
| REVIEW | DONE | None |
| REVIEW | IN_PROGRESS | feedback required |
| DONE | CLOSED | None |

### Forbidden Transitions

The following transitions are NOT allowed:
- CLOSED -> any state (closed tasks cannot be reopened)
- REVIEW -> READY (cannot go back to ready state)
- DONE -> IN_PROGRESS (cannot restart after completion, create new task instead)

### Transition Validation Logic

```
function isValidTransition(currentState, targetState, feedback):
    validTransitions = {
        "BACKLOG": ["READY", "CLOSED"],
        "READY": ["IN_PROGRESS", "BACKLOG", "CLOSED"],
        "IN_PROGRESS": ["REVIEW", "CLOSED"],
        "REVIEW": ["DONE", "IN_PROGRESS"],
        "DONE": ["CLOSED"],
        "CLOSED": []
    }

    if targetState not in validTransitions[currentState]:
        return { valid: false, reason: "Invalid state transition." }

    if currentState == "REVIEW" and targetState == "IN_PROGRESS":
        if not feedback or feedback.trim() == "":
            return { valid: false, reason: "Cannot reject without feedback." }

    return { valid: true }
```

## Automatic Actions on Transition (Phase 1)

### READY -> IN_PROGRESS

1. Set `started_at` field to current time
2. Set `branch` field to `feature/{TASK-ID}`
3. Add progress note to context file

**Output**:
```
Task started: {TASK-ID} - {title}

Branch: feature/{TASK-ID}
Context: {context_file}

Starting work.
```

### IN_PROGRESS -> REVIEW

1. Add progress note to context file

**Output**:
```
Review requested: {TASK-ID} - {title}

Waiting for developer confirmation.
Approve: /project:task-approve {TASK-ID}
Reject: /project:task-reject {TASK-ID} --feedback "feedback content"
```

### REVIEW -> IN_PROGRESS (Rejection)

1. Add feedback to `feedback_history`
2. Record feedback in context file

**Output**:
```
Feedback required: {TASK-ID}

Feedback: {feedback content}

Continuing work.
```

### REVIEW -> DONE

1. Set `completed_at` field to current time
2. Set all unresolved feedback `resolved` to true
3. Record in context file

**Output**:
```
Review approved: {TASK-ID} - {title}

To finalize: /project:task-complete {TASK-ID}
```

### DONE -> CLOSED

1. Record in context file

**Output**:
```
Task closed: {TASK-ID} - {title}

Total duration: {calculated from started_at to completed_at}
```

### * -> CLOSED (Cancellation)

1. Record in context file

**Output**:
```
Task cancelled: {TASK-ID} - {title}
```

## Error Messages

### Invalid Transition
```
State transition failed

Current status: {current status}
Requested status: {target status}
Reason: {reason}

Allowed transitions: {allowed statuses from current status}
```

### Missing Feedback
```
Feedback required

Feedback must be provided when rejecting review.

Usage: /project:task-reject {TASK-ID} --feedback "feedback content"
```
