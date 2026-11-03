import { defineConfig } from 'tsdown'

/**
 * Rolldown plugin: DSH serves only /plugins/<id>/client.js, so the emitted
 * client.css must ride inside the JS. At generateBundle we read the CSS asset
 * and prepend a runtime <style> injector to the client chunk.
 */
function inlineCss() {
  return {
    name: 'dsh-vscode-inline-css',
    generateBundle(_opts: unknown, bundle: Record<string, { type: string; code?: string; source?: string | Uint8Array }>) {
      let clientKey: string | undefined
      let cssKey: string | undefined
      let cssText = ''
      for (const [k, b] of Object.entries(bundle)) {
        if (b.type === 'chunk' && /client/.test(k) && !clientKey) clientKey = k
        if (b.type === 'asset' && /.css$/.test(k)) { cssKey = k; cssText = typeof b.source === 'string' ? b.source : Buffer.from(b.source as Uint8Array).toString('utf8') }
      }
      if (clientKey && cssKey && cssText) {
        const chunk = bundle[clientKey]
        const injector = `;(function(){var d=document;var s=d.createElement('style');s.setAttribute('data-dsh-vscode','');s.textContent=${JSON.stringify(cssText)};(d.head||d.documentElement).appendChild(s);})();`
        ;(chunk as { code: string }).code = injector + (chunk.code ?? '')
        delete bundle[cssKey]
      }
    },
  }
}

/** Wrap client.js in the DSH module-loader factory form:
 * window.__ModuleLoader__.load({ id, factory: (require) => { ...body...; return module.exports } }).
 * The CJS body already uses 'require' and assigns onto 'exports', so wrapping
 * it inside the factory provides the require shim and module.exports carrier.
 * The index (host) entry is left untouched. */
function wrapModuleLoader() {
  return {
    name: 'dsh-vscode-wrap-module-loader',
    renderChunk(code: string, info: { fileName: string }) {
      if (!/client\.js$/.test(info.fileName)) return null
      const wrapped = [
        'window.__ModuleLoader__.load({',
        '\tid: "@zhaoyang10/dsh-web-vscode",',
        '\tfactory: (require) => {',
        '\t\tvar module = { exports: {} };',
        '\t\tvar exports = module.exports;',
        '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
        code,
        '\t\treturn module.exports;',
        '\t}',
        '});',
        '',
      ].join('\n')
      return { code: wrapped, map: undefined }
    },
  }
}

export default defineConfig([
  // Host entries: plain ESM. index.js is the VscodeTools Remote service;
  // typert.host.js is the strict typert manifest the typert-loader reads via
  // the package's './typert' export. DSH host packages stay external (the
  // host resolves them through its own node_modules).
  {
    entry: { index: 'src/index.ts', 'typert.host': 'src/typert.host.ts' },
    format: 'esm',
    outDir: 'lib',
    dts: { compile: true },
    outExtensions: () => ({ js: '.js' }),
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      /^@deepseek-ai\//,
      'zod',
    ],
  },
  // Client entry: CJS wrapped in the window.__ModuleLoader__ factory form.
  // Only React stays external; zod is bundled (no Monaco here, so the client
  // chunk stays small).
  {
    entry: { client: 'src/client/index.ts' },
    format: 'cjs',
    outDir: 'lib',
    outExtensions: () => ({ js: '.js' }),
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      /^@deepseek-ai\//,
    ],
    noExternal: ['zod'],
    plugins: [inlineCss(), wrapModuleLoader()],
    outputOptions: {
      inlineDynamicImports: true,
    },
  },
])
