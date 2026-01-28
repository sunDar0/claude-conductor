# Claude Conductor - Phase 5 상세 구현 스펙 (Part B)

> **목표**: Sub Agent 오케스트레이션 - Agent 프레임워크, Skill 연동, 병렬 실행
> **범위**: Step 8-13 (실행 엔진 및 통합) + 가이드라인

---

## Step 8: 오케스트레이션 도구

### 파일: `src/handlers/orchestration.handlers.ts`

```typescript
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import type { McpServer } from '@anthropic/mcp-server';
import type { OrchestrationPlan, ExecutionStrategy, AgentRole } from '../types/agent.types';
import { ParallelEngine } from '../orchestration/parallel-engine';

export function registerOrchestrationHandlers(server: McpServer, engine: ParallelEngine) {

  // ===========================================
  // orchestrate - 오케스트레이션 플랜 실행
  // ===========================================
  server.tool(
    'orchestrate',
    '여러 Agent를 조합하여 복잡한 태스크를 실행합니다. 병렬/순차 실행을 지원합니다.',
    {
      task_id: z.string().describe('대상 태스크 ID'),
      strategy: z.enum(['parallel', 'sequential', 'pipeline'])
        .describe('실행 전략'),
      agents: z.array(z.object({
        role: z.enum(['code', 'test', 'review', 'docs', 'security', 'performance']),
        skills: z.array(z.string()).optional(),
        stage: z.number().optional().describe('파이프라인 스테이지 번호 (pipeline 전략에서 사용)'),
      })).describe('실행할 Agent 목록'),
      options: z.object({
        timeout_ms: z.number().optional().default(600000),
        stop_on_error: z.boolean().optional().default(false),
      }).optional(),
    },
    async ({ task_id, strategy, agents, options }) => {
      try {
        // 플랜 생성
        const plan: OrchestrationPlan = {
          id: `plan-${Date.now()}-${uuid().slice(0, 8)}`,
          task_id,
          strategy,
          stages: buildStages(strategy, agents),
          created_at: new Date().toISOString(),
          status: 'pending',
        };

        // 실행
        const result = await engine.execute(plan);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              plan_id: plan.id,
              strategy,
              agents_executed: result.agents.length,
              conflicts: result.conflicts.length,
              summary: result.summary,
              merged_output: result.merged_output,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // orchestrate_review - 코드 리뷰 오케스트레이션
  // ===========================================
  server.tool(
    'orchestrate_review',
    '여러 관점의 Agent로 코드 리뷰를 병렬 실행합니다.',
    {
      task_id: z.string().describe('리뷰할 태스크 ID'),
      perspectives: z.array(z.enum(['code-review', 'security', 'performance']))
        .default(['code-review', 'security'])
        .describe('리뷰 관점'),
    },
    async ({ task_id, perspectives }) => {
      try {
        const agents = perspectives.map(p => ({
          role: p === 'code-review' ? 'review' : p,
          skills: [p],
        }));

        const plan: OrchestrationPlan = {
          id: `review-${Date.now()}`,
          task_id,
          strategy: 'parallel',
          stages: [{
            stage_id: 'review',
            name: 'Multi-perspective Review',
            agents: agents as any,
            parallel: true,
            timeout_ms: 300000,
          }],
          created_at: new Date().toISOString(),
          status: 'pending',
        };

        const result = await engine.execute(plan);

        // 리뷰 결과 통합
        const allIssues = result.agents
          .flatMap(a => a.output?.issues || [])
          .sort((a, b) => {
            const severity = { critical: 0, warning: 1, info: 2 };
            return (severity[a.severity as keyof typeof severity] || 2) -
                   (severity[b.severity as keyof typeof severity] || 2);
          });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              task_id,
              perspectives_reviewed: perspectives,
              total_issues: allIssues.length,
              issues_by_severity: {
                critical: allIssues.filter(i => i.severity === 'critical').length,
                warning: allIssues.filter(i => i.severity === 'warning').length,
                info: allIssues.filter(i => i.severity === 'info').length,
              },
              issues: allIssues,
              summary: result.summary,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // ===========================================
  // orchestrate_implement - 구현 오케스트레이션
  // ===========================================
  server.tool(
    'orchestrate_implement',
    '코드 구현 → 테스트 작성 → 리뷰 파이프라인을 실행합니다.',
    {
      task_id: z.string().describe('구현할 태스크 ID'),
      include_docs: z.boolean().default(false).describe('문서화 포함 여부'),
    },
    async ({ task_id, include_docs }) => {
      try {
        const stages = [
          {
            stage_id: 'implement',
            name: 'Code Implementation',
            agents: [{ role: 'code' as AgentRole, skills: ['coding'] }],
            parallel: false,
            timeout_ms: 300000,
          },
          {
            stage_id: 'test',
            name: 'Test Writing',
            agents: [{ role: 'test' as AgentRole, skills: ['testing'] }],
            parallel: false,
            timeout_ms: 180000,
          },
          {
            stage_id: 'review',
            name: 'Code Review',
            agents: [
              { role: 'review' as AgentRole, skills: ['code-review'] },
              { role: 'security' as AgentRole, skills: ['security'] },
            ],
            parallel: true,
            timeout_ms: 180000,
          },
        ];

        if (include_docs) {
          stages.push({
            stage_id: 'docs',
            name: 'Documentation',
            agents: [{ role: 'docs' as AgentRole, skills: ['api-docs', 'changelog'] }],
            parallel: false,
            timeout_ms: 120000,
          });
        }

        const plan: OrchestrationPlan = {
          id: `impl-${Date.now()}`,
          task_id,
          strategy: 'pipeline',
          stages,
          created_at: new Date().toISOString(),
          status: 'pending',
        };

        const result = await engine.execute(plan);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              task_id,
              stages_completed: plan.stages.length,
              pipeline: plan.stages.map(s => s.name),
              summary: result.summary,
              artifacts: result.agents.flatMap(a => a.artifacts),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );
}

// ===========================================
// Helper: 스테이지 빌드
// ===========================================
function buildStages(
  strategy: ExecutionStrategy,
  agents: { role: AgentRole; skills?: string[]; stage?: number }[]
): OrchestrationPlan['stages'] {
  switch (strategy) {
    case 'parallel':
      return [{
        stage_id: 'parallel-all',
        name: 'Parallel Execution',
        agents: agents.map(a => ({ role: a.role, skills: a.skills })),
        parallel: true,
        timeout_ms: 300000,
      }];

    case 'sequential':
      return agents.map((a, i) => ({
        stage_id: `seq-${i}`,
        name: `Step ${i + 1}: ${a.role}`,
        agents: [{ role: a.role, skills: a.skills }],
        parallel: false,
        timeout_ms: 180000,
      }));

    case 'pipeline':
      // stage 번호로 그룹핑
      const stageMap = new Map<number, typeof agents>();
      agents.forEach(a => {
        const stageNum = a.stage || 0;
        if (!stageMap.has(stageNum)) stageMap.set(stageNum, []);
        stageMap.get(stageNum)!.push(a);
      });

      return Array.from(stageMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([num, stageAgents]) => ({
          stage_id: `stage-${num}`,
          name: `Stage ${num}`,
          agents: stageAgents.map(a => ({ role: a.role, skills: a.skills })),
          parallel: stageAgents.length > 1,
          timeout_ms: 300000,
        }));

    default:
      return [];
  }
}
```

---

## Step 9: Agent 정의 파일

### 파일: `.claude/agents/_template.yaml`

```yaml
# Agent 정의 템플릿
# 이 파일을 복사하여 새 Agent를 정의하세요

role: custom                    # 필수: Agent 역할 ID
name: "Custom Agent"            # 필수: 표시 이름
description: |                  # 필수: 역할 설명
  이 Agent의 역할과 목적을 설명합니다.

# Skill 설정
skills:
  required:                     # 필수 Skill (없으면 에러)
    - skill-name
  optional:                     # 선택 Skill (없어도 동작)
    - optional-skill

# 시스템 프롬프트
# {{skills}}, {{role}}, {{name}}, {{constraints}} 변수 사용 가능
system_prompt: |
  당신은 {{name}}입니다.
  역할: {{role}}

  ## 장착된 Skill
  {{skills}}

  ## 제약사항
  {{constraints}}

  ## 작업 지침
  [여기에 구체적인 지침 작성]

# 사용 가능한 MCP 도구
tools:
  - tool_name_1
  - tool_name_2

# 제약사항 (시스템 프롬프트에 주입)
constraints:
  - "제약사항 1"
  - "제약사항 2"

# 출력 형식 정의
output_format:
  type: "result_type"
  schema:
    field1: string
    field2: array

# 실행 설정
config:
  timeout_ms: 300000            # 5분
  max_retries: 2
  parallel_allowed: true        # 병렬 실행 허용 여부
```

### 파일: `.claude/agents/code-agent.yaml`

```yaml
role: code
name: "Code Implementation Agent"
description: |
  코드 구현 전문 Agent입니다.
  클린 코드 원칙을 따르며, 테스트 가능한 코드를 작성합니다.

skills:
  required:
    - coding
  optional:
    - refactor
    - patterns

system_prompt: |
  당신은 {{name}}입니다.

  ## 역할
  코드 구현을 담당하는 전문 Agent입니다.

  ## 장착된 Skill
  {{skills}}

  ## 핵심 원칙
  1. **클린 코드**: 읽기 쉽고 유지보수 가능한 코드
  2. **SOLID 원칙**: 단일 책임, 개방-폐쇄 등
  3. **테스트 용이성**: 의존성 주입, 인터페이스 분리
  4. **에러 처리**: 명확한 예외 처리

  ## 제약사항
  {{constraints}}

  ## 출력 형식
  작업 완료 후 다음을 포함해 보고:
  - 생성/수정한 파일 목록
  - 주요 구현 내용
  - 고려한 엣지 케이스

tools:
  - file_read
  - file_write
  - file_search
  - git_status
  - git_diff
  - git_commit

constraints:
  - "직접 프로덕션 배포 금지"
  - "기존 테스트가 깨지지 않도록 주의"
  - "API 스키마 변경 시 문서 업데이트 필요"

output_format:
  type: "code_result"
  schema:
    files_created:
      type: array
      items: string
    files_modified:
      type: array
      items: string
    summary: string
    considerations:
      type: array
      items: string

config:
  timeout_ms: 300000
  max_retries: 2
  parallel_allowed: false
```

### 파일: `.claude/agents/test-agent.yaml`

```yaml
role: test
name: "Test Writing Agent"
description: |
  테스트 작성 전문 Agent입니다.
  단위 테스트, 통합 테스트를 작성하고 커버리지를 분석합니다.

skills:
  required:
    - testing
  optional:
    - coverage
    - e2e

system_prompt: |
  당신은 {{name}}입니다.

  ## 역할
  테스트 코드 작성을 담당하는 전문 Agent입니다.

  ## 장착된 Skill
  {{skills}}

  ## 테스트 원칙
  1. **AAA 패턴**: Arrange, Act, Assert
  2. **격리**: 각 테스트는 독립적으로 실행
  3. **명확한 이름**: 테스트 의도가 드러나는 이름
  4. **엣지 케이스**: 경계 조건, 예외 상황 테스트

  ## 테스트 종류
  - 단위 테스트: 개별 함수/메서드
  - 통합 테스트: 모듈 간 상호작용
  - E2E 테스트: 전체 흐름 (선택적)

  ## 제약사항
  {{constraints}}

tools:
  - file_read
  - file_write
  - test_run
  - coverage_report

constraints:
  - "실제 외부 서비스 호출 금지 (Mock 사용)"
  - "테스트 데이터는 fixture로 관리"
  - "비동기 테스트는 적절한 타임아웃 설정"

output_format:
  type: "test_result"
  schema:
    tests_created:
      type: array
      items: string
    coverage:
      type: object
      properties:
        lines: number
        branches: number
        functions: number
    edge_cases:
      type: array
      items: string

config:
  timeout_ms: 180000
  max_retries: 2
  parallel_allowed: true
```

### 파일: `.claude/agents/review-agent.yaml`

```yaml
role: review
name: "Code Review Agent"
description: |
  코드 리뷰 전문 Agent입니다.
  코드 품질, 설계, 잠재적 버그를 검토합니다.

skills:
  required:
    - code-review
  optional:
    - security
    - performance

system_prompt: |
  당신은 {{name}}입니다.

  ## 역할
  코드 리뷰를 담당하는 전문 Agent입니다.

  ## 장착된 Skill
  {{skills}}

  ## 리뷰 관점
  1. **정확성**: 로직이 올바른가?
  2. **가독성**: 이해하기 쉬운가?
  3. **유지보수성**: 변경이 용이한가?
  4. **성능**: 비효율적인 부분은 없는가?
  5. **보안**: 취약점은 없는가?

  ## 심각도 기준
  - CRITICAL: 즉시 수정 필요 (보안, 데이터 손실)
  - WARNING: 권장 수정 (버그 가능성, 성능)
  - INFO: 개선 제안 (스타일, 리팩토링)

  ## 제약사항
  {{constraints}}

  ## 출력 형식
  각 이슈에 대해:
  - 위치 (파일, 라인)
  - 심각도
  - 설명
  - 수정 제안

tools:
  - file_read
  - git_diff
  - review_request
  - review_submit

constraints:
  - "직접 파일 수정 금지"
  - "객관적이고 건설적인 피드백"
  - "승인/반려 결정은 Main Agent에게 위임"

output_format:
  type: "review_result"
  schema:
    summary: string
    issues:
      type: array
      items:
        type: object
        properties:
          file: string
          line: number
          severity: string
          message: string
          suggestion: string
    recommendation: string

config:
  timeout_ms: 180000
  max_retries: 1
  parallel_allowed: true
```

### 파일: `.claude/agents/docs-agent.yaml`

```yaml
role: docs
name: "Documentation Agent"
description: |
  문서화 전문 Agent입니다.
  API 문서, README, Changelog를 작성합니다.

skills:
  required:
    - api-docs
  optional:
    - changelog
    - readme

system_prompt: |
  당신은 {{name}}입니다.

  ## 역할
  문서화를 담당하는 전문 Agent입니다.

  ## 장착된 Skill
  {{skills}}

  ## 문서화 원칙
  1. **명확성**: 누구나 이해할 수 있게
  2. **완전성**: 필요한 정보를 빠짐없이
  3. **최신성**: 코드와 문서의 동기화
  4. **예제**: 사용 예제 포함

  ## 문서 종류
  - API 문서: OpenAPI/Swagger 형식
  - README: 프로젝트 소개, 설치, 사용법
  - Changelog: 변경 이력 (Keep a Changelog)
  - 인라인 주석: JSDoc, TSDoc

  ## 제약사항
  {{constraints}}

tools:
  - file_read
  - file_write
  - changelog_generate
  - api_docs_generate

constraints:
  - "기존 문서 스타일 유지"
  - "Markdown 형식 준수"
  - "코드 예제는 실제 동작하는 코드로"

output_format:
  type: "docs_result"
  schema:
    files_created:
      type: array
      items: string
    files_updated:
      type: array
      items: string
    doc_types:
      type: array
      items: string

config:
  timeout_ms: 120000
  max_retries: 2
  parallel_allowed: true
```

### 파일: `.claude/agents/security-agent.yaml`

```yaml
role: security
name: "Security Review Agent"
description: |
  보안 검토 전문 Agent입니다.
  보안 취약점을 탐지하고 수정 방안을 제시합니다.

skills:
  required:
    - security
  optional:
    - code-review

system_prompt: |
  당신은 {{name}}입니다.

  ## 역할
  보안 검토를 담당하는 전문 Agent입니다.

  ## 장착된 Skill
  {{skills}}

  ## 검토 항목
  ### 입력 검증
  - SQL Injection
  - XSS (Cross-Site Scripting)
  - Command Injection
  - Path Traversal

  ### 인증/인가
  - 하드코딩된 자격증명
  - 취약한 암호화
  - 부적절한 세션 관리
  - 권한 상승 가능성

  ### 데이터 보호
  - 민감 정보 노출
  - 부적절한 로깅
  - 안전하지 않은 통신

  ### 의존성
  - 알려진 취약점 (CVE)
  - 오래된 패키지

  ## 심각도 기준
  - CRITICAL: 즉각적인 보안 위협
  - HIGH: 악용 가능한 취약점
  - MEDIUM: 잠재적 위험
  - LOW: 모범 사례 위반

  ## 제약사항
  {{constraints}}

tools:
  - file_read
  - git_diff
  - dependency_check
  - secret_scan

constraints:
  - "발견된 취약점 정보는 안전하게 보고"
  - "실제 공격 코드 작성 금지"
  - "수정 방안은 구체적으로 제시"

output_format:
  type: "security_result"
  schema:
    summary: string
    vulnerabilities:
      type: array
      items:
        type: object
        properties:
          type: string
          severity: string
          location: string
          description: string
          remediation: string
          cwe: string
    risk_score: number

config:
  timeout_ms: 180000
  max_retries: 1
  parallel_allowed: true
```

---

## Step 10: Skill 정의 파일 (Agent용)

### 파일: `.claude/skills/coding/SKILL.md`

```markdown
# Coding Skill

> Code Agent가 참조하는 코딩 원칙과 패턴

## 클린 코드 원칙

### 1. 명명 규칙
- 의미 있는 이름 사용
- 발음 가능한 이름
- 검색 가능한 이름
- 인코딩 피하기 (헝가리안 표기법 등)

### 2. 함수
- 작게 만들기 (20줄 이하 권장)
- 한 가지 일만 하기
- 추상화 수준 통일
- 서술적인 이름
- 인자 개수 최소화 (3개 이하)

### 3. 주석
- 코드로 의도 표현이 우선
- 필요한 경우에만 주석
- TODO, FIXME 사용
- 주석이 필요하면 코드 개선 고려

### 4. 포맷팅
- 일관된 들여쓰기
- 적절한 공백
- 관련 코드 그룹핑
- 선언과 할당 분리

## SOLID 원칙

### S - 단일 책임 원칙 (SRP)
클래스는 하나의 책임만 가져야 함

### O - 개방-폐쇄 원칙 (OCP)
확장에는 열려있고, 수정에는 닫혀있어야 함

### L - 리스코프 치환 원칙 (LSP)
자식 클래스는 부모 클래스를 대체할 수 있어야 함

### I - 인터페이스 분리 원칙 (ISP)
클라이언트별로 세분화된 인터페이스

### D - 의존 역전 원칙 (DIP)
추상화에 의존, 구체화에 의존하지 않음

## 디자인 패턴 (자주 사용)

### 생성 패턴
- Factory: 객체 생성 캡슐화
- Builder: 복잡한 객체 단계별 생성
- Singleton: 인스턴스 하나만 보장

### 구조 패턴
- Adapter: 인터페이스 변환
- Decorator: 동적 기능 추가
- Facade: 복잡한 시스템의 단순 인터페이스

### 행위 패턴
- Observer: 상태 변화 알림
- Strategy: 알고리즘 교체
- Command: 요청을 객체로 캡슐화

## 에러 처리

### 원칙
1. 예외를 통한 에러 처리 (return code 지양)
2. 호출자를 고려한 예외 클래스
3. 정상 흐름 정의 (Special Case Pattern)
4. null 반환/전달 지양

### 패턴
```typescript
// Good: Custom Exception
throw new ValidationError('Invalid email format');

// Good: Either Pattern
function parse(input: string): Either<Error, Data> {
  ...
}

// Good: Optional
function findUser(id: string): User | undefined {
  ...
}
```

## 체크리스트

- [ ] 함수가 한 가지 일만 하는가?
- [ ] 변수/함수 이름이 의도를 드러내는가?
- [ ] 중복 코드가 없는가?
- [ ] 적절한 추상화 수준인가?
- [ ] 에러 처리가 명확한가?
- [ ] 테스트 작성이 용이한가?
```

### 파일: `.claude/skills/testing/SKILL.md`

```markdown
# Testing Skill

> Test Agent가 참조하는 테스트 작성 가이드

## 테스트 피라미드

```
        /\
       /  \       E2E Tests (적음)
      /    \      - 전체 시스템 테스트
     /------\     - 느림, 비용 높음
    /        \
   /  통합    \   Integration Tests (중간)
  /   테스트   \  - 모듈 간 상호작용
 /--------------\ - 중간 속도
/                \
/    단위 테스트   \ Unit Tests (많음)
/------------------\ - 개별 함수/클래스
                     - 빠름, 격리됨
```

## AAA 패턴

```typescript
describe('Calculator', () => {
  it('should add two numbers', () => {
    // Arrange - 준비
    const calculator = new Calculator();
    const a = 5;
    const b = 3;

    // Act - 실행
    const result = calculator.add(a, b);

    // Assert - 검증
    expect(result).toBe(8);
  });
});
```

## 테스트 명명 규칙

### 패턴: should_ExpectedBehavior_When_Condition

```typescript
// Good
it('should throw ValidationError when email is invalid')
it('should return empty array when no users found')
it('should send notification when order is placed')

// Bad
it('test1')
it('email test')
it('works correctly')
```

## Mock vs Stub vs Spy

### Mock
- 행위 검증 (호출 여부, 인자 확인)
```typescript
const mockNotifier = jest.fn();
await orderService.place(order);
expect(mockNotifier).toHaveBeenCalledWith(order.id);
```

### Stub
- 미리 정의된 응답 반환
```typescript
const stubRepository = {
  findById: jest.fn().mockReturnValue({ id: 1, name: 'Test' })
};
```

### Spy
- 실제 구현 호출하면서 추적
```typescript
const spy = jest.spyOn(console, 'log');
service.doSomething();
expect(spy).toHaveBeenCalled();
```

## 엣지 케이스 체크리스트

### 입력값
- [ ] null / undefined
- [ ] 빈 문자열 / 빈 배열
- [ ] 최대/최소 경계값
- [ ] 특수 문자
- [ ] 유니코드
- [ ] 매우 긴 입력

### 상태
- [ ] 초기 상태
- [ ] 중간 상태
- [ ] 종료 상태
- [ ] 동시 접근

### 에러
- [ ] 네트워크 실패
- [ ] 타임아웃
- [ ] 인증 실패
- [ ] 권한 없음
- [ ] 리소스 없음

## 테스트 격리

```typescript
describe('UserService', () => {
  let service: UserService;
  let mockRepo: jest.Mocked<UserRepository>;

  beforeEach(() => {
    // 각 테스트마다 새로운 인스턴스
    mockRepo = createMockRepository();
    service = new UserService(mockRepo);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});
```

## 비동기 테스트

```typescript
// Promise
it('should fetch user', async () => {
  const user = await userService.fetch(1);
  expect(user).toBeDefined();
});

// Callback (지양)
it('should fetch user', (done) => {
  userService.fetch(1, (err, user) => {
    expect(user).toBeDefined();
    done();
  });
});

// Timeout
it('should complete within 1s', async () => {
  await expect(
    heavyOperation()
  ).resolves.toBeDefined();
}, 1000);
```

## 커버리지 목표

| 메트릭 | 최소 | 권장 |
|--------|------|------|
| Lines | 70% | 85% |
| Branches | 65% | 80% |
| Functions | 70% | 85% |
| Statements | 70% | 85% |
```

### 파일: `.claude/skills/security/SKILL.md`

```markdown
# Security Skill

> Security Agent가 참조하는 보안 검토 가이드

## OWASP Top 10 (2021)

### A01: Broken Access Control
- 수평/수직 권한 상승
- IDOR (Insecure Direct Object Reference)
- 메타데이터 조작

**검토 포인트:**
```typescript
// Bad: 직접 객체 참조
app.get('/user/:id', (req, res) => {
  return db.getUser(req.params.id);  // 권한 체크 없음
});

// Good: 권한 검증
app.get('/user/:id', authorize, (req, res) => {
  if (req.user.id !== req.params.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return db.getUser(req.params.id);
});
```

### A02: Cryptographic Failures
- 민감 데이터 평문 저장/전송
- 취약한 암호화 알고리즘
- 하드코딩된 키

**검토 포인트:**
```typescript
// Bad
const password = "admin123";  // 하드코딩
const hash = md5(password);   // 취약한 알고리즘

// Good
const hash = await bcrypt.hash(password, 12);
const key = process.env.ENCRYPTION_KEY;
```

### A03: Injection
- SQL Injection
- NoSQL Injection
- Command Injection
- LDAP Injection

**검토 포인트:**
```typescript
// Bad: SQL Injection
const query = `SELECT * FROM users WHERE id = ${userId}`;

// Good: Parameterized Query
const query = 'SELECT * FROM users WHERE id = $1';
await db.query(query, [userId]);
```

### A07: XSS (Cross-Site Scripting)
- Reflected XSS
- Stored XSS
- DOM-based XSS

**검토 포인트:**
```typescript
// Bad: 직접 HTML 삽입
element.innerHTML = userInput;

// Good: 텍스트로 처리
element.textContent = userInput;

// Good: 라이브러리 사용
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userInput);
```

## 보안 체크리스트

### 인증 (Authentication)
- [ ] 비밀번호 정책 (길이, 복잡도)
- [ ] 브루트포스 방지 (Rate limiting)
- [ ] 세션 관리 (타임아웃, 재사용 방지)
- [ ] MFA 지원

### 인가 (Authorization)
- [ ] 최소 권한 원칙
- [ ] RBAC/ABAC 구현
- [ ] API 레벨 권한 체크

### 입력 검증
- [ ] 화이트리스트 검증
- [ ] 길이 제한
- [ ] 타입 검증
- [ ] 인코딩/이스케이프

### 출력 인코딩
- [ ] HTML 이스케이프
- [ ] URL 인코딩
- [ ] JavaScript 이스케이프
- [ ] SQL 파라미터화

### 암호화
- [ ] 전송 중 암호화 (TLS)
- [ ] 저장 시 암호화 (AES-256)
- [ ] 비밀번호 해싱 (bcrypt/argon2)
- [ ] 키 관리

### 로깅/모니터링
- [ ] 보안 이벤트 로깅
- [ ] 민감 정보 마스킹
- [ ] 이상 탐지

## 심각도 매핑

| 심각도 | CVSS | 예시 |
|--------|------|------|
| CRITICAL | 9.0-10.0 | RCE, SQL Injection |
| HIGH | 7.0-8.9 | XSS, SSRF |
| MEDIUM | 4.0-6.9 | CSRF, 정보 노출 |
| LOW | 0.1-3.9 | 설정 미흡 |

## CWE 참조

- CWE-89: SQL Injection
- CWE-79: XSS
- CWE-352: CSRF
- CWE-287: 부적절한 인증
- CWE-862: 누락된 인가
- CWE-798: 하드코딩된 자격증명
```

---

## Step 11: 워크플로우 정의

### 파일: `.claude/orchestration/workflows/implement.yaml`

```yaml
name: implement
description: "코드 구현 → 테스트 → 리뷰 파이프라인"
version: "1.0"

# 트리거 조건
triggers:
  - event: task_start
    condition: "task.status == 'IN_PROGRESS'"

# 실행 스테이지
stages:
  - id: implement
    name: "코드 구현"
    agents:
      - role: code
        skills: [coding]
    timeout_ms: 300000

  - id: test
    name: "테스트 작성"
    depends_on: [implement]
    agents:
      - role: test
        skills: [testing]
    timeout_ms: 180000

  - id: review
    name: "코드 리뷰"
    depends_on: [test]
    parallel: true
    agents:
      - role: review
        skills: [code-review]
      - role: security
        skills: [security]
    timeout_ms: 180000

# 완료 조건
completion:
  all_stages_success: true
  min_test_coverage: 70
  max_critical_issues: 0

# 실패 시 동작
on_failure:
  notify: true
  rollback: false
```

### 파일: `.claude/orchestration/workflows/review.yaml`

```yaml
name: review
description: "다관점 코드 리뷰 워크플로우"
version: "1.0"

triggers:
  - event: task_transition
    condition: "transition.to == 'REVIEW'"

stages:
  - id: multi-review
    name: "다관점 리뷰"
    parallel: true
    agents:
      - role: review
        skills: [code-review]
        focus: "로직 및 설계"
      - role: security
        skills: [security]
        focus: "보안 취약점"
      - role: performance
        skills: [performance]
        focus: "성능 이슈"
    timeout_ms: 180000

  - id: aggregate
    name: "결과 통합"
    depends_on: [multi-review]
    action: merge_results
    config:
      dedup_by: [file, line]
      sort_by: severity

completion:
  generate_report: true
  report_format: markdown
```

### 파일: `.claude/orchestration/workflows/full-cycle.yaml`

```yaml
name: full-cycle
description: "전체 개발 사이클 (구현 → 테스트 → 리뷰 → 문서화)"
version: "1.0"

triggers:
  - event: manual
  - event: task_create
    condition: "task.priority == 'critical'"

stages:
  - id: analyze
    name: "요구사항 분석"
    agents:
      - role: code
        skills: [coding]
        action: analyze_requirements
    timeout_ms: 120000

  - id: implement
    name: "코드 구현"
    depends_on: [analyze]
    agents:
      - role: code
        skills: [coding]
    timeout_ms: 300000

  - id: test
    name: "테스트 작성"
    depends_on: [implement]
    agents:
      - role: test
        skills: [testing, coverage]
    timeout_ms: 180000

  - id: review
    name: "코드 리뷰"
    depends_on: [test]
    parallel: true
    agents:
      - role: review
        skills: [code-review]
      - role: security
        skills: [security]
    timeout_ms: 180000

  - id: docs
    name: "문서화"
    depends_on: [review]
    agents:
      - role: docs
        skills: [api-docs, changelog]
    timeout_ms: 120000

completion:
  all_stages_success: true
  auto_transition: true
  transition_to: REVIEW
```

---

## Step 12: 대시보드 통합 (Phase 4 확장)

### 파일: `src/components/agent/AgentPanel.tsx`

```tsx
import { useEffect, useState } from 'react';
import { Bot, Play, Square, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { useAgentStore } from '../../store/agentStore';

const STATUS_ICONS = {
  idle: Clock,
  ready: Clock,
  running: RefreshCw,
  completed: CheckCircle,
  error: XCircle,
  terminated: Square,
};

const STATUS_COLORS = {
  idle: 'text-gray-500',
  ready: 'text-blue-500',
  running: 'text-yellow-500 animate-spin',
  completed: 'text-green-500',
  error: 'text-red-500',
  terminated: 'text-gray-400',
};

export function AgentPanel() {
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const loading = useAgentStore((s) => s.loading);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, []);

  const agentList = Object.values(agents);
  const running = agentList.filter(a => a.status === 'running').length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-purple-500" />
          <h2 className="font-semibold">Sub Agents</h2>
          {running > 0 && (
            <Badge className="bg-yellow-100 text-yellow-800">
              {running} running
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchAgents} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {agentList.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            활성 Agent 없음
          </div>
        ) : (
          agentList.map((agent) => {
            const Icon = STATUS_ICONS[agent.status];
            return (
              <div
                key={agent.id}
                className="bg-white dark:bg-gray-800 rounded-lg p-3 border dark:border-gray-700"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${STATUS_COLORS[agent.status]}`} />
                    <span className="font-medium">{agent.role}</span>
                  </div>
                  <Badge variant="outline">{agent.status}</Badge>
                </div>

                <div className="text-xs text-gray-500 space-y-1">
                  <div>Task: {agent.task_id || 'N/A'}</div>
                  <div>Skills: {agent.skills_loaded.join(', ')}</div>
                  <div>ID: {agent.id.slice(-12)}</div>
                </div>

                {agent.status === 'running' && (
                  <div className="mt-2 pt-2 border-t dark:border-gray-700">
                    <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                      <div className="h-full bg-yellow-500 animate-pulse w-2/3" />
                    </div>
                  </div>
                )}

                {agent.error && (
                  <div className="mt-2 text-xs text-red-500">
                    Error: {agent.error}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

### 파일: `src/store/agentStore.ts`

```typescript
import { create } from 'zustand';
import type { AgentInstance, AgentRole } from '../types';
import { api } from '../lib/api';

interface AgentState {
  agents: Record<string, AgentInstance>;
  loading: boolean;
  error: string | null;

  fetchAgents: () => Promise<void>;
  updateAgent: (agent: AgentInstance) => void;
  removeAgent: (agentId: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: {},
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true });
    try {
      const response = await api.get('/api/agents');
      const agentsMap: Record<string, AgentInstance> = {};
      response.data.agents.forEach((a: AgentInstance) => {
        agentsMap[a.id] = a;
      });
      set({ agents: agentsMap, loading: false });
    } catch (err) {
      set({ error: 'Failed to fetch agents', loading: false });
    }
  },

  updateAgent: (agent) => {
    set((state) => ({
      agents: { ...state.agents, [agent.id]: agent },
    }));
  },

  removeAgent: (agentId) => {
    set((state) => {
      const { [agentId]: _, ...rest } = state.agents;
      return { agents: rest };
    });
  },
}));
```

---

## Step 13: MCP 서버 통합

### 파일: `src/index.ts` (업데이트)

```typescript
import { createMcpServer } from '@anthropic/mcp-server';
import { RedisClient } from './redis';
import { AgentRegistry } from './orchestration/agent-registry';
import { SkillLoader } from './orchestration/skill-loader';
import { AgentManager } from './orchestration/agent-manager';
import { ParallelEngine } from './orchestration/parallel-engine';

// 기존 핸들러
import { registerTaskHandlers } from './handlers/task.handlers';
import { registerServerHandlers } from './handlers/server.handlers';
import { registerReviewHandlers } from './handlers/review.handlers';
import { registerChangelogHandlers } from './handlers/changelog.handlers';

// 신규 핸들러
import { registerAgentHandlers } from './handlers/agent.handlers';
import { registerOrchestrationHandlers } from './handlers/orchestration.handlers';

async function main() {
  const workspaceDir = process.env.WORKSPACE_DIR || '/workspace';

  // Redis 연결
  const redis = new RedisClient(process.env.REDIS_URL || 'redis://localhost:6379');
  await redis.connect();

  // 오케스트레이션 초기화
  const registry = new AgentRegistry(workspaceDir);
  await registry.initialize();

  const skillLoader = new SkillLoader(workspaceDir);

  const agentManager = new AgentManager(registry, skillLoader, redis);
  await agentManager.restoreInstances();

  const parallelEngine = new ParallelEngine(agentManager);

  // MCP 서버 생성
  const server = createMcpServer({
    name: 'claude-conductor',
    version: '1.0.0',
  });

  // 핸들러 등록
  registerTaskHandlers(server, redis, workspaceDir);
  registerServerHandlers(server, redis, workspaceDir);
  registerReviewHandlers(server, redis, workspaceDir);
  registerChangelogHandlers(server, redis, workspaceDir);

  // 신규: Agent 및 오케스트레이션 핸들러
  registerAgentHandlers(server, agentManager);
  registerOrchestrationHandlers(server, parallelEngine);

  // WebSocket 이벤트 포워딩
  agentManager.on('agent:spawned', (data) => redis.publish('agent:spawned', data));
  agentManager.on('agent:started', (data) => redis.publish('agent:started', data));
  agentManager.on('agent:completed', (data) => redis.publish('agent:completed', data));
  agentManager.on('agent:error', (data) => redis.publish('agent:error', data));
  agentManager.on('agent:terminated', (data) => redis.publish('agent:terminated', data));

  // 서버 시작
  await server.start();
  console.log('[Conductor] MCP Server started with Agent orchestration');
}

main().catch(console.error);
```

---

## 검증 테스트

### 테스트 1: Agent 생성 및 조회

```bash
# Claude Code에서 실행
> agent_list_roles

# 예상 출력:
{
  "success": true,
  "count": 5,
  "roles": [
    { "role": "code", "name": "Code Implementation Agent", ... },
    { "role": "test", "name": "Test Writing Agent", ... },
    { "role": "review", "name": "Code Review Agent", ... },
    { "role": "docs", "name": "Documentation Agent", ... },
    { "role": "security", "name": "Security Review Agent", ... }
  ]
}
```

### 테스트 2: Agent Spawn

```bash
> agent_spawn role="code" task_id="TASK-001" skills=["coding"]

# 예상 출력:
{
  "success": true,
  "agent_id": "agent-code-1706123456-abc12345",
  "role": "code",
  "status": "ready",
  "skills_loaded": ["coding"],
  "message": "code Agent가 생성되었습니다."
}
```

### 테스트 3: 병렬 리뷰

```bash
> orchestrate_review task_id="TASK-001" perspectives=["code-review", "security"]

# 예상 출력:
{
  "success": true,
  "task_id": "TASK-001",
  "perspectives_reviewed": ["code-review", "security"],
  "total_issues": 5,
  "issues_by_severity": {
    "critical": 1,
    "warning": 2,
    "info": 2
  },
  "issues": [...],
  "summary": "## 실행 요약\n- 총 Agent: 2개\n- 성공: 2개\n..."
}
```

### 테스트 4: 구현 파이프라인

```bash
> orchestrate_implement task_id="TASK-001" include_docs=true

# 예상 출력:
{
  "success": true,
  "task_id": "TASK-001",
  "stages_completed": 4,
  "pipeline": [
    "Code Implementation",
    "Test Writing",
    "Code Review",
    "Documentation"
  ],
  "summary": "...",
  "artifacts": [...]
}
```

---

## 파일 체크리스트

### 신규 파일

| 파일 | 설명 | 우선순위 |
|------|------|:--------:|
| `src/types/agent.types.ts` | Agent 관련 타입 정의 | P0 |
| `src/orchestration/agent-registry.ts` | Agent 정의 로드 | P0 |
| `src/orchestration/skill-loader.ts` | Skill 로드 및 주입 | P0 |
| `src/orchestration/agent-manager.ts` | Agent 생명주기 관리 | P0 |
| `src/orchestration/parallel-engine.ts` | 병렬 실행 엔진 | P0 |
| `src/handlers/agent.handlers.ts` | Agent MCP 도구 | P0 |
| `src/handlers/orchestration.handlers.ts` | 오케스트레이션 도구 | P0 |
| `.claude/agents/_template.yaml` | Agent 템플릿 | P0 |
| `.claude/agents/code-agent.yaml` | Code Agent 정의 | P0 |
| `.claude/agents/test-agent.yaml` | Test Agent 정의 | P0 |
| `.claude/agents/review-agent.yaml` | Review Agent 정의 | P0 |
| `.claude/agents/docs-agent.yaml` | Docs Agent 정의 | P1 |
| `.claude/agents/security-agent.yaml` | Security Agent 정의 | P1 |
| `.claude/skills/coding/SKILL.md` | 코딩 Skill | P0 |
| `.claude/skills/testing/SKILL.md` | 테스트 Skill | P0 |
| `.claude/skills/security/SKILL.md` | 보안 Skill | P1 |
| `.claude/orchestration/workflows/*.yaml` | 워크플로우 정의 | P1 |
| `src/components/agent/AgentPanel.tsx` | 대시보드 Agent 패널 | P1 |
| `src/store/agentStore.ts` | Agent 상태 스토어 | P1 |

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/index.ts` | Agent/Orchestration 핸들러 등록 |
| `src/types/index.ts` | Agent 타입 export |
| `docker-compose.yml` | 환경 변수 추가 (필요 시) |

---

## 사용 예시

### 시나리오 1: 단일 Agent 사용

```
User: "TASK-001 구현해줘"

Claude:
1. agent_spawn(role="code", task_id="TASK-001", skills=["coding"])
2. agent_delegate(agent_id, instructions="로그인 API 구현...")
3. (Agent 실행 대기)
4. agent_collect(agent_id)
5. 결과 보고
```

### 시나리오 2: 병렬 리뷰

```
User: "TASK-001 리뷰해줘"

Claude:
1. orchestrate_review(task_id="TASK-001", perspectives=["code-review", "security", "performance"])
2. (3개 Agent 병렬 실행)
3. 결과 자동 병합
4. 통합 리뷰 리포트 제공
```

### 시나리오 3: 전체 파이프라인

```
User: "TASK-001 처음부터 끝까지 처리해줘"

Claude:
1. orchestrate_implement(task_id="TASK-001", include_docs=true)
2. Stage 1: Code Agent → 구현
3. Stage 2: Test Agent → 테스트
4. Stage 3: Review + Security Agent (병렬) → 리뷰
5. Stage 4: Docs Agent → 문서화
6. 전체 결과 보고
```

---

*Phase 5 Part B 문서 끝*
*이전: Part A - Step 1-7 (기본 인프라)*
*다음: Phase 6 - 알림 및 외부 연동 (선택)*
