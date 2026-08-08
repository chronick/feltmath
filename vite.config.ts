import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps the build relocatable (works at chronick.github.io/blackjack-trainer)
export default defineConfig({
  plugins: [react()],
  base: './',
})
