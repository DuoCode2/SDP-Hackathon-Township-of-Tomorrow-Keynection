import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
    // The file watcher missed some edits on Windows during setup; polling makes reloads reliable.
    watch: { usePolling: true, interval: 300 },
  },
  // Pre-bundle every runtime dependency at start-up. Otherwise Vite may re-bundle mid-session,
  // load two copies of React and crash the page in the middle of a demo.
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'lucide-react', 'qrcode'] },
})
