import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Injects a Content-Security-Policy meta tag into index.html that is
 * permissive enough for Vite HMR in dev mode (`command === 'serve'`) and
 * strict in production builds. The index.html file must contain the
 * marker `<!--CSP-->` in <head> as a placeholder.
 *
 * Keeping the marker in the source HTML (rather than a hard-coded meta
 * tag) is what lets the same index.html work for both modes.
 */
function cspPlugin(isDev: boolean): Plugin {
  const devCsp = [
    "default-src 'self' http://localhost:5173 ws://localhost:5173",
    "style-src 'self' 'unsafe-inline' http://localhost:5173",
    "script-src 'self' http://localhost:5173 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'self' http://localhost:5173 ws://localhost:5173",
    "img-src 'self' data: http://localhost:5173",
    "font-src 'self' data: http://localhost:5173"
  ].join('; ')

  const prodCsp =
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'"

  const csp = isDev ? devCsp : prodCsp
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`

  return {
    name: 'csp-meta-injection',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string): string {
        return html.replace(/<!--\s*CSP\s*-->/, tag)
      }
    }
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), cspPlugin(command === 'serve')],
  base: './',
  root: path.resolve(__dirname, 'src/renderer'),
  publicDir: path.resolve(__dirname, 'public'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true
  }
}))
