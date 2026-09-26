import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const configuredBase = env.VITE_BASE_PATH?.trim()
  const base = !configuredBase || configuredBase === '/'
    ? '/'
    : `${configuredBase.startsWith('/') ? configuredBase : `/${configuredBase}`}/`.replace(/\/+$/, '/')
  return {
    plugins: [react()],
    base,
    build: {
      rollupOptions: {
        input: {
          user: 'index.html',
          admin: 'admin.html',
        },
        output: {
          // Split rarely-changing vendor code from app code so a deploy that
          // only touches app logic doesn't invalidate the cached vendor
          // chunk for returning visitors, and so react/supabase-js/icons
          // (which change far less often than the app itself) aren't
          // re-downloaded on every release.
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-icons': ['lucide-react'],
          },
        },
      },
    },
  }
})
