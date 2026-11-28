import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
const root = path.resolve(__dirname, '../..')
export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(root, 'public'),
  plugins: [react()],
  resolve: { alias: [{ find: /^(\.\.?\/)+(lib\/)?supabase$/, replacement: path.resolve(__dirname, 'mock.ts') }] },
  server: { port: 5188, host: '127.0.0.1', fs: { allow: [root] } },
})
