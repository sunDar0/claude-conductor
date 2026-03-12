# Claude Conductor 설치 가이드

> 새 macOS 또는 Windows 환경에서 프로젝트를 처음부터 설정하는 방법을 안내합니다.

---

## 목차

1. [사전 요구사항](#1-사전-요구사항)
2. [macOS 설치](#2-macos-설치)
3. [Windows 설치](#3-windows-설치)
4. [프로젝트 설정 (공통)](#4-프로젝트-설정-공통)
5. [실행 및 확인](#5-실행-및-확인)
6. [문제 해결](#6-문제-해결)

---

## 1. 사전 요구사항

| 도구 | 최소 버전 | 용도 |
|------|-----------|------|
| **Node.js** | 24.0.0 이상 | 백엔드/프론트엔드 런타임 |
| **pnpm** | 9.0 이상 | 패키지 매니저 |
| **Docker Desktop** | 최신 | Redis 컨테이너 실행 |
| **Git** | 2.30 이상 | 소스 코드 관리 |

> **Node.js 24 참고**: Node.js 24는 Current 채널 릴리스입니다 (LTS는 아님). 이 프로젝트의 `engines` 설정에서 `>=24.0.0`을 요구하므로, 반드시 24 이상 버전을 설치해야 합니다.

### 버전 확인 체크리스트

모든 도구 설치 후 아래 명령어로 확인합니다.

```bash
git --version            # 2.30+
node --version           # 24.0.0+
pnpm --version           # 9.0+
docker --version         # 최신
docker compose version   # 최신
```

---

## 2. macOS 설치

### 2.1 Homebrew 설치

터미널(`Terminal.app`)을 열고 실행합니다.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

설치 후 셸 설정을 적용합니다.

```bash
# Apple Silicon (M1/M2/M3/M4) Mac인 경우
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

# Intel Mac인 경우 (자동으로 /usr/local에 설치됨)
```

### 2.2 Git 설치

macOS에는 Xcode Command Line Tools에 Git이 포함되어 있습니다.

```bash
# 이미 설치되어 있는지 확인
git --version

# 없으면 설치
xcode-select --install
```

### 2.3 Node.js 설치 (fnm 사용 권장)

```bash
# fnm (Fast Node Manager) 설치
brew install fnm

# 셸 설정 추가
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc
source ~/.zshrc

# Node.js 24 설치 및 활성화
fnm install 24
fnm use 24
fnm default 24

# 확인
node --version   # v24.x.x
```

### 2.4 pnpm 설치

```bash
# corepack으로 설치 (Node.js 내장)
corepack enable
corepack prepare pnpm@latest --activate

# 확인
pnpm --version
```

### 2.5 Docker Desktop 설치

```bash
brew install --cask docker
```

설치 후 **Docker Desktop 앱을 실행**합니다. 상단 메뉴바에 Docker 아이콘(고래)이 나타나면 준비 완료입니다.

```bash
# 확인
docker --version
docker compose version
```

> **참고**: Docker Compose V2부터 `docker compose` (공백) 형태가 표준입니다. `docker-compose` (하이픈) 명령이 없다는 오류가 나면, Docker Desktop을 최신 버전으로 업데이트하세요. 이 프로젝트의 `start.sh`는 `docker-compose`를 사용하므로, 필요한 경우 호환 스크립트를 설치할 수 있습니다:
> ```bash
> # docker-compose 호환이 필요한 경우 (보통 Docker Desktop 최신 버전에서는 불필요)
> brew install docker-compose
> ```

---

## 3. Windows 설치

### 3.1 패키지 매니저 (winget)

Windows 10 이상에는 `winget`이 기본 포함되어 있습니다. PowerShell을 **관리자 권한**으로 실행합니다.

```powershell
# winget 확인
winget --version
```

### 3.2 Git 설치

```powershell
winget install Git.Git
```

설치 후 **새 PowerShell 창**을 열어 적용합니다.

```powershell
git --version
```

### 3.3 Node.js 설치 (fnm 사용 권장)

```powershell
# fnm 설치
winget install Schniz.fnm

# 환경변수 설정 (새 PowerShell 창을 열고 실행)
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression

# PowerShell 프로필에 영구 추가
# 프로필 파일이 없으면 자동 생성
if (!(Test-Path $PROFILE)) { New-Item -Path $PROFILE -Force }
Add-Content -Path $PROFILE -Value 'fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression'

# Node.js 24 설치
fnm install 24
fnm use 24
fnm default 24

# 확인
node --version   # v24.x.x
```

### 3.4 pnpm 설치

```powershell
corepack enable
corepack prepare pnpm@latest --activate

# 확인
pnpm --version
```

### 3.5 Docker Desktop 설치

```powershell
winget install Docker.DockerDesktop
```

설치 후 **PC를 재시작**합니다. Docker Desktop이 자동으로 실행되며, WSL 2 백엔드를 사용합니다.

> **참고**: WSL 2가 설치되어 있지 않으면 Docker Desktop이 자동으로 설치를 안내합니다. 안내에 따라 진행하세요.

```powershell
# 확인
docker --version
docker compose version
```

---

## 4. 프로젝트 설정 (공통)

### 4.1 저장소 클론

```bash
git clone https://github.com/sunDar0/claude-conductor.git
cd claude-conductor
```

### 4.2 의존성 설치

```bash
# Conductor (백엔드) 의존성
cd conductor-mcp/services/conductor
pnpm install

# Dashboard (프론트엔드) 의존성
cd ../dashboard
pnpm install

# 프로젝트 루트로 복귀
cd ../../..
```

### 4.3 환경 변수 설정

> **참고**: `start.sh`를 사용하면 `WORKSPACE_DIR`이 자동 설정되므로, 이 단계는 **개별 수동 실행 시에만** 필요합니다.

환경 변수 파일을 Conductor 서비스 디렉토리에 생성합니다. (`dotenv`가 실행 CWD 기준으로 `.env`를 로드합니다.)

```bash
# 예시 파일을 복사하여 .env 생성
cp conductor-mcp/.env.example conductor-mcp/services/conductor/.env
```

`conductor-mcp/services/conductor/.env` 파일을 열어 `WORKSPACE_DIR`을 프로젝트 루트의 절대 경로로 수정합니다.

```bash
# macOS 예시
WORKSPACE_DIR=/Users/yourname/work/claude-conductor

# Windows 예시 (Git Bash 사용 시)
WORKSPACE_DIR=C:/Users/yourname/work/claude-conductor
```

### 4.4 레지스트리 디렉토리 초기화

프로젝트가 처음이라면 레지스트리 디렉토리를 생성합니다.

```bash
mkdir -p .claude/tasks
mkdir -p .claude/projects
mkdir -p .claude/servers
```

레지스트리 파일이 없으면 자동 생성되지만, 디렉토리는 미리 만들어두는 것이 안전합니다.

---

## 5. 실행 및 확인

### 5.1 전체 시스템 시작 (macOS / Git Bash)

```bash
# 실행 권한 부여 (최초 1회)
chmod +x start.sh

# 시작
./start.sh
```

`start.sh`는 다음을 순서대로 수행합니다:
1. Redis 컨테이너 시작 (`docker-compose up -d redis`)
2. Conductor 서버 시작 (HTTP + WebSocket)
3. Dashboard 시작 (Vite dev server)

> **주의**: `start.sh`에서 `docker-compose` (하이픈) 명령을 사용합니다. Docker Desktop 최신 버전에서 `docker-compose` 명령을 찾을 수 없다는 오류가 발생하면, [2.5 Docker Desktop 설치](#25-docker-desktop-설치) 섹션의 참고 사항을 확인하세요.

### 5.2 Windows에서 실행

Windows에서는 `start.sh`를 직접 실행할 수 없으므로 수동으로 각 서비스를 시작합니다.

**터미널 1 — Redis**:
```powershell
cd conductor-mcp
docker compose up -d redis
```

**터미널 2 — Conductor**:
```powershell
cd conductor-mcp\services\conductor
$env:WORKSPACE_DIR = (Resolve-Path "..\..\..").Path
pnpm run start:all
```

**터미널 3 — Dashboard**:
```powershell
cd conductor-mcp\services\dashboard
pnpm run dev
```

> **팁**: Git Bash를 사용하면 `./start.sh`를 그대로 실행할 수 있습니다.

### 5.3 접속 확인

시스템이 정상적으로 시작되면 아래 URL로 접속합니다.

| 서비스 | URL | 설명 |
|--------|-----|------|
| Dashboard | http://localhost:4000 | 웹 UI (칸반보드) |
| API | http://localhost:3100 | REST API |
| Health Check | http://localhost:3100/health | 서버 상태 확인 |
| WebSocket | ws://localhost:3101 | 실시간 이벤트 |

```bash
# 헬스체크 확인
curl http://localhost:3100/health
# 정상 응답: {"status":"ok","timestamp":"..."}
```

### 5.4 종료

- **`start.sh`로 시작한 경우**: `Ctrl+C`로 Conductor와 Dashboard가 종료됩니다. 단, **Redis 컨테이너는 백그라운드에서 계속 실행**됩니다. Redis도 종료하려면:
  ```bash
  cd conductor-mcp
  docker compose down
  ```
- **수동 시작한 경우**: 각 터미널에서 `Ctrl+C`로 종료 후 Redis를 중지합니다:
  ```bash
  cd conductor-mcp
  docker compose down
  ```

---

## 6. 문제 해결

### Docker Desktop이 실행되지 않음

**증상**: `docker: Cannot connect to the Docker daemon`

**해결**:
- Docker Desktop 앱이 실행 중인지 확인합니다
- Windows: 시스템 트레이에서 Docker 아이콘을 확인합니다
- macOS: 상단 메뉴바에서 Docker 고래 아이콘을 확인합니다

### `docker-compose` 명령을 찾을 수 없음

**증상**: `command not found: docker-compose`

Docker Compose V2부터 `docker compose` (공백)가 표준 명령입니다. 두 가지 해결 방법이 있습니다:

```bash
# 방법 1: docker compose (공백)로 직접 실행
cd conductor-mcp
docker compose up -d redis

# 방법 2: docker-compose 호환 패키지 설치 (macOS)
brew install docker-compose
```

### Redis 컨테이너가 시작되지 않음

**증상**: `Error: connect ECONNREFUSED 127.0.0.1:6379`

```bash
# Redis 컨테이너 상태 확인
docker ps -a | grep redis

# 컨테이너 로그 확인
docker logs conductor-redis

# 재시작
cd conductor-mcp
docker compose down
docker compose up -d redis
```

### 포트 충돌 (EADDRINUSE)

**증상**: `Error: listen EADDRINUSE: address already in use :::3100`

```bash
# macOS / Linux: 포트 사용 프로세스 확인
lsof -i :3100

# Windows (PowerShell):
netstat -ano | findstr :3100

# 해당 프로세스 종료 후 재실행
```

### Node.js 버전 오류

**증상**: `The engine "node" is incompatible with this module`

```bash
# 현재 버전 확인
node --version

# Node.js 24로 전환
fnm use 24
```

### pnpm install 실패

```bash
# 캐시 초기화 후 재시도 (lockfile은 유지)
pnpm store prune
cd conductor-mcp/services/conductor
rm -rf node_modules
pnpm install

cd ../dashboard
rm -rf node_modules
pnpm install
```

> **주의**: `pnpm-lock.yaml`은 삭제하지 마세요. lockfile을 삭제하면 의존성 버전이 달라져 예기치 않은 오류가 발생할 수 있습니다.

### Windows에서 start.sh 실행 오류

Git Bash를 사용하거나, 위의 [5.2 Windows에서 실행](#52-windows에서-실행) 섹션을 참고하여 수동으로 시작합니다.

```bash
# Git Bash에서 실행
bash start.sh
```
