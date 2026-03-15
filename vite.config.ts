import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// 모바일(Capacitor) 빌드 시: VITE_BUILD_TARGET=mobile npm run build
const isMobile = process.env.VITE_BUILD_TARGET === 'mobile'

// https://vite.dev/config/
export default defineConfig({
  base: isMobile ? './' : '/coffee-bet/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Coffee Bet App',
        short_name: 'CoffeeBet',
        description: '직장인 커피 내기 마블 레이스 앱',
        theme_color: '#121212',
        background_color: '#121212',
        display: 'standalone',
        icons: [
          {
            src: 'coffee-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'coffee-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'coffee-512.png',
            sizes: 'any',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
})
