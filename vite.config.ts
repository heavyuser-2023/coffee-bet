import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/coffee-bet/',
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
            src: 'coffee.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'coffee.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          },
          {
            src: 'coffee.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
})
