import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps every asset reference relative, which is what lets the same
// build serve from a GitHub Pages subpath and from the custom subdomain.
export default defineConfig({
  base: './',
  plugins: [react()],
})
