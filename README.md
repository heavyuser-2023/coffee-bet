# Coffee Bet App ☕

직장인 커피 내기 마블 레이스 앱

## 기술 스택

- **프론트엔드**: React + TypeScript + Vite
- **백엔드**: Convex
- **네이티브 앱**: Capacitor (iOS + Android)
- **웹 호스팅**: GitHub Pages

---

## 🚀 배포 및 빌드 가이드

### 1. 웹 배포 (GitHub Pages)

```bash
# 빌드 + GitHub Pages 배포
npm run deploy
```

### 2. Convex 서버 배포

```bash
# Convex 함수(백엔드)를 프로덕션에 배포
npx convex deploy
```

### 3. 모바일 네이티브 앱 (Capacitor)

#### [1단계] 모바일용 웹 에셋 빌드 및 동기화

Capacitor는 빌드된 웹 파일(`dist/`)을 네이티브 컨테이너로 복사(동기화)하여 사용합니다. 코드를 수정했다면 항상 아래 커맨드를 먼저 실행하세요.

```bash
# 모바일용 빌드(base: './') + 네이티브 프로젝트 동기화 (한 번에)
npm run cap:build
```

> ⚠️ **중요**: 소스 코드(React/TS)를 수정한 후에는 반드시 `npm run cap:build`를 실행해야 Xcode/Android Studio에 변경사항이 반영됩니다. 이 과정 없이 Xcode에서 Run(⌘+R)만 하면 이전 빌드가 실행됩니다.

#### [2단계] Android 실행 및 테스트

```bash
# Android Studio에서 프로젝트 열기
npx cap open android
```
- **개발/테스트**: Android Studio 상단의 ▶️ (Run) 버튼을 눌러 에뮬레이터나 연결된 실기기에서 앱을 실행합니다.
- **출시 빌드**: 메뉴에서 `Build` > `Generate Signed Bundle / APK`를 선택하고, 기존 프로젝트 폴더에 있는 `android.keystore` 파일을 서명 키로 지정하여 릴리즈 번들(AAB)을 만듭니다.

#### [3단계] iOS 실행 및 테스트

```bash
# Xcode에서 프로젝트 열기
npx cap open ios
```
- **초기 설정**: Xcode 좌측 파일 트리에서 `App`을 클릭하고, **Signing & Capabilities** 탭에서 **Apple Developer 계정(Team)** 을 반드시 지정해야 합니다.
- **개발/테스트**: 좌측 상단의 ▶️ (Run) 버튼을 눌러 시뮬레이터나 연결된 iPhone에서 앱을 실행합니다.
- **출시 빌드**: 상단 메뉴 `Product` > `Destination`을 `Any iOS Device`로 변경한 후, `Product` > `Archive`를 실행하여 App Store Connect로 제출합니다.

> **참고**: iOS 빌드 환경 설정 및 App Store 배포를 위해서는 macOS, Xcode, 그리고 유료 Apple Developer 계정($99/년)이 필요합니다.

#### 코드 수정 → 네이티브 앱 반영 요약

```bash
# 1. 소스 코드 수정
# 2. 모바일 빌드 + 동기화
npm run build:mobile && npx cap sync
# 3. Xcode(⌘+R) 또는 Android Studio(▶️)에서 실행
```

### 4. 로컬 개발 (Convex 백엔드 + 프론트엔드 연동)

로컬에서 개발 및 테스트를 하려면 **Convex 백엔드 서버**와 **Vite 프론트엔드 서버**가 모두 실행되어야 합니다. 처음 실행할 때 Convex 로그인 및 로컬 개발용 프로젝트 설정이 진행됩니다.

#### 방법 A: 한 번에 실행하기 (권장 💡)
하나의 터미널 창에서 Convex 백엔드 파일 감시(watch) 및 배포와 Vite 프론트엔드 개발 서버를 함께 실행합니다.
```bash
# Convex 백엔드와 Vite 개발 서버를 동시에 실행
npx convex dev --run-sh "npm run dev"
```

#### 방법 B: 터미널을 분리하여 실행하기
백엔드 로그와 프론트엔드 로그를 개별 터미널에서 따로 확인하고 싶을 때 사용합니다.

1. **터미널 1**: Convex 백엔드 개발 서버 실행 (스키마 및 함수 실시간 동기화)
   ```bash
   npx convex dev
   ```
   *최초 실행 시 Convex 가입/로그인 창이 열릴 수 있습니다. 로그인을 완료하고 프로젝트를 생성/선택하면 로컬 개발 샌드박스가 배포되고 `.env.local` 파일이 자동으로 생성됩니다.*

2. **터미널 2**: 프론트엔드 Vite 개발 서버 실행
   ```bash
   npm run dev
   ```

#### 빌드 프리뷰 (로컬 빌드 결과물 최종 검증)
```bash
npm run build && npm run preview
```

---

## 프로젝트 구조

```
coffee-bet/
├── src/              # React 소스 코드
├── public/           # 정적 파일
├── dist/             # 빌드 출력 (gitignore)
├── android/          # Capacitor Android 프로젝트
├── ios/              # Capacitor iOS 프로젝트
├── convex/           # Convex 백엔드
├── capacitor.config.ts  # Capacitor 설정
├── vite.config.ts    # Vite 설정
└── package.json
```