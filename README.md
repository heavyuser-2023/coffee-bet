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

### 2. 모바일 네이티브 앱 (Capacitor)

#### [1단계] 모바일용 웹 에셋 빌드 및 동기화

Capacitor는 빌드된 웹 파일(`dist/`)을 네이티브 컨테이너로 복사(동기화)하여 사용합니다. 코드를 수정했다면 항상 아래 커맨드를 먼저 실행하세요.

```bash
# 모바일용 빌드(base: './') + 네이티브 프로젝트 동기화 (한 번에)
npm run cap:build
```

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

### 3. 로컬 개발

```bash
# 개발 서버 실행
npm run dev

# 프리뷰 (빌드된 결과물 로컬 확인)
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