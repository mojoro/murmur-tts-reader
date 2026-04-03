// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@vite-pwa/nuxt'],
  compatibilityDate: '2025-03-23',
  ssr: false,
  css: ['./app.css'],
  devServer: {
    port: 4000
  },
  colorMode: {
    preference: 'dark'
  },
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'pocket-tts',
      short_name: 'pocket-tts',
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
    },
  },
})
