/**
 * Static server for scripts/test-ui: serves the preview page and bundles its
 * TypeScript entry with rolldown on boot (the same bundler tsdown uses), so the
 * page always renders the CURRENT src/client sources.
 *
 *   node scripts/test-ui-server.mjs [--port 8898]
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const uiDir = join(root, 'scripts', 'test-ui')
const portArg = process.argv.findIndex((a) => a === '--port')
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 8898

const rolldownEntry = join(root, 'node_modules', '.pnpm', 'rolldown@1.0.0-beta.9', 'node_modules', 'rolldown', 'dist', 'index.mjs')
const { rolldown } = await import(pathToFileURL(rolldownEntry).href)

const bundle = await rolldown({
  input: join(uiDir, 'preview-entry.tsx'),
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
  resolve: {
    alias: {
      react: join(root, 'node_modules', 'react', 'index.js'),
      'react-dom/client': join(root, 'node_modules', 'react-dom', 'client.js'),
      'react/jsx-runtime': join(root, 'node_modules', 'react', 'jsx-runtime.js'),
    },
  },
})
const built = await bundle.generate({ format: 'iife', name: 'Preview' })
const code = built.output.map((chunk) => chunk.code ?? '').join('\n')

createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(readFileSync(join(uiDir, 'index.html'), 'utf8'))
    return
  }
  if (url === '/preview.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' })
    res.end(code)
    return
  }
  res.writeHead(404)
  res.end('not found')
}).listen(port, '127.0.0.1', () => console.log('test-ui on http://127.0.0.1:' + port))
