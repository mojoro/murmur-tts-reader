// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@vite-pwa/nuxt'],
  compatibilityDate: '2025-03-23',
  ssr: true,
  runtimeConfig: {
    orchestratorUrl: 'http://localhost:8000',
    jwtSecret: 'dev-secret-change-in-production',
  },
  css: ['./app.css'],
  devServer: {
    port: 4000
  },
  vite: {
    server: {
      watch: {
        ignored: [
          '**/pocket-tts-server/**',
          '**/xtts-server/**',
          '**/f5tts-server/**',
          '**/gptsovits-server/**',
          '**/cosyvoice-server/**',
          '**/orchestrator/**',
          '**/data/**',
        ],
      },
    },
  },
  colorMode: {
    preference: 'dark'
  },
  pwa: {
    devOptions: { enabled: false },
    registerType: 'autoUpdate',
    manifest: {
      name: 'Murmur',
      short_name: 'Murmur',
      description: 'Offline text-to-speech reader with voice cloning',
      theme_color: '#0a0a0a',
      background_color: '#0a0a0a',
      display: 'standalone',
      icons: [
        {
          src: '/icons/pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: '/icons/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
      navigateFallbackDenylist: [/^\/api\//],
      runtimeCaching: [
        {
          // Cache audio files — immutable once generated
          urlPattern: /\/api\/audio\/.+/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'audio-cache',
            expiration: {
              maxEntries: 5000,
              maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          // Cache reads list
          urlPattern: /\/api\/reads(\?.*)?$/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'api-reads',
            networkTimeoutSeconds: 3,
            expiration: { maxEntries: 5 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          // Cache individual read details
          urlPattern: /\/api\/reads\/\d+$/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'api-read-detail',
            networkTimeoutSeconds: 3,
            expiration: { maxEntries: 200 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          // Cache bookmarks per read
          urlPattern: /\/api\/reads\/\d+\/bookmarks/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'api-bookmarks',
            networkTimeoutSeconds: 3,
            expiration: { maxEntries: 200 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          // Cache voices list
          urlPattern: /\/api\/voices(\?.*)?$/,
          handler: 'StaleWhileRevalidate',
          options: {
            cacheName: 'api-voices',
            expiration: { maxEntries: 5 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
  },
})
