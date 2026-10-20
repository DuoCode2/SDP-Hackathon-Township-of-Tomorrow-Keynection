import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // KEYNECTION_API_PORT (or the old JIRAN_API_PORT) lets a second copy (e.g. a test backend) run beside the demo on 8000.
    // /wake too: the wake word's engine is kept gzipped and only the server sends it as it is (wake_file).
    proxy: Object.fromEntries(['/api', '/wake'].map((p) => [p, `http://127.0.0.1:${process.env.KEYNECTION_API_PORT ?? process.env.JIRAN_API_PORT ?? '8000'}`])),
    // The file watcher missed some edits on Windows during setup; polling makes reloads reliable.
    watch: { usePolling: true, interval: 300 },
  },
  // Pre-bundle every runtime dependency at start-up. Otherwise Vite may re-bundle mid-session,
  // load two copies of React and crash the page in the middle of a demo.
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'lucide-react', 'qrcode'] },
})
