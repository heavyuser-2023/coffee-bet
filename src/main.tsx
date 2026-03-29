import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'

import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";

// PWA 서비스 워커는 웹(브라우저)에서만 등록.
// Capacitor 네이티브 앱(WKWebView)에서 서비스 워커가 동작하면
// 요청을 가로채서 blank page가 발생할 수 있음 (App Store 심사 리젝 원인).
const isNativeApp = !!(
  (window as any).webkit?.messageHandlers?.bridge  // iOS (Capacitor)
  || (window as any).androidBridge                  // Android (Capacitor)
);
if (!isNativeApp) {
  registerSW({ immediate: true })
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <App />
    </ConvexAuthProvider>
  </StrictMode>,
)
