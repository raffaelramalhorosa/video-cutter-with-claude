import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
  server: {
    // libera o acesso à raiz do repo para importar remotion/src/MotionText.tsx
    // (fonte única: o preview ao vivo usa o MESMO componente do render do .mov)
    fs: { allow: ['..'] },
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8765',
      '/media': 'http://localhost:8765',
      '/motion': 'http://localhost:8765',
    },
  },
})
