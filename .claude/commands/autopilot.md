# Conductor Auto-Pilot

자동으로 READY 태스크를 찾아서 처리합니다.

## 실행 단계

1. **태스크 확인**: `task_list` MCP 도구로 READY 상태 태스크 조회
2. **태스크 없음**: "대기 중인 태스크가 없습니다" 출력 후 종료
3. **태스크 있음**: 첫 번째 READY 태스크 자동 처리 시작

## 태스크 처리 흐름

```
READY 태스크 발견
    ↓
task_start로 IN_PROGRESS 전환
    ↓
태스크 내용 분석 및 작업 수행
    ↓
코드 변경, 테스트, 문서화
    ↓
task_transition으로 REVIEW 전환
    ↓
사용자에게 결과 보고
```

## 사용법

```
/project:autopilot
```

또는 Claude Code 세션에서:
```
autopilot 모드로 READY 태스크 처리해줘
```
