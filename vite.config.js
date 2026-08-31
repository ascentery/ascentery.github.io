import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ascentery.github.io is a USER site, served from the domain root.
// base is '/' — not '/ascentery/'. This is the one line that broke
// old Ascentery, and on a user site it's simply the default.
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
})
