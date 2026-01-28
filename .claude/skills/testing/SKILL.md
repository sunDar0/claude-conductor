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
