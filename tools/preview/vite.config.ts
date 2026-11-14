import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
const root = path.resolve(__dirname, '../..')
export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(root, 'public'),
  plugins: [react()],
  resolve: { alias: [{ find: /^(\.\.?\/)+lib\/supabase$/, replacement: path.resolve(__dirname, 'supabase-mock.ts') }] },
  server: { port: 5199, fs: { allow: [root] } },
})
