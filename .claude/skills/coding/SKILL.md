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

## TypeScript 베스트 프랙티스

### 타입 정의
```typescript
// Good: 명시적 타입
interface User {
  id: string;
  name: string;
  email: string;
}

// Good: 유니온 타입
type Status = 'pending' | 'active' | 'inactive';

// Good: 제네릭
function identity<T>(arg: T): T {
  return arg;
}
```

### Null 안전성
```typescript
// Good: Optional chaining
const name = user?.profile?.name;

// Good: Nullish coalescing
const value = input ?? defaultValue;

// Good: Type guard
function isUser(obj: unknown): obj is User {
  return typeof obj === 'object' && obj !== null && 'id' in obj;
}
```

## 체크리스트

- [ ] 함수가 한 가지 일만 하는가?
- [ ] 변수/함수 이름이 의도를 드러내는가?
- [ ] 중복 코드가 없는가?
- [ ] 적절한 추상화 수준인가?
- [ ] 에러 처리가 명확한가?
- [ ] 테스트 작성이 용이한가?
