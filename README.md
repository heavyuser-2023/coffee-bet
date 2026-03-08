# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```


## 🚀 배포 및 빌드 가이드

### 1. 웹 배포 (GitHub Pages)
GitHub Pages를 통해 웹 버전을 배포합니다. `gh-pages` 패키지를 사용하며, 빌드된 결과물이 `gh-pages` 브랜치로 자동 푸시되어 웹사이트에 반영됩니다.
```bash
# 최신 코드로 사이트를 빌드하고 GitHub Pages에 배포
npm run deploy
```

### 2. 안드로이드 정식 앱 번들 (AAB) 빌드
**Google Play 스토어 출시용** 포맷인 Android App Bundle(.aab)을 생성하는 방법입니다. Android 폴더 내에서 Gradle 명령어로 다이렉트 빌드합니다.
```bash
# android 디렉토리로 이동 후 명령어 실행
cd android
./gradlew clean bundleRelease

# 빌드 완료 후 AAB 파일 위치:
# android/app/build/outputs/bundle/release/app-release.aab
```

### 3. 안드로이드 설치용 앱 (APK) 빌드 및 테스팅
실기기나 에뮬레이터에 직접 설치(`adb install`)하거나 배포하기 위한 **APK** 포맷 생성 방법입니다.

#### 💡 정식 서명된 배포/설치용 APK 빌드 (권장)
가장 권장되는 방식입니다. Bubblewrap CLI를 통해 기존에 설정된 키스토어를 이용해 자동으로 릴리즈 서명된 APK를 만듭니다.
```bash
# 프로젝트 최상위 루트 폴더에서 실행
npx @bubblewrap/cli build

# 비밀번호 입력 창이 나오면 기존에 설정된 암호를 입력하세요.
# (기본 비밀번호: password123)

# 빌드 완료 후 연결된 기기나 에뮬레이터에 앱 설치
adb install -r app-release-signed.apk
```

#### 🛠 일반 테스트용 빌드 (Unsigned APK)
디버깅이나 단순 확인 등 서명이 생략된 테스트용 Android 빌드가 필요할 경우 사용하는 명령어입니다.
```bash
cd android
./gradlew assembleRelease

# 빌드 완료 후 미서명 APK 파일 위치:
# android/app/build/outputs/apk/release/app-release-unsigned.apk
```