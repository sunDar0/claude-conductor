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
