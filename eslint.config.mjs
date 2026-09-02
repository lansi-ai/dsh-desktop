import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/** Node CommonJS 脚本全局（scripts/*.cjs）。 */
const NODE_GLOBALS = {
  globalThis: 'readonly',
  require: 'readonly',
  module: 'readonly',
  exports: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  process: 'readonly',
  console: 'readonly',
  setImmediate: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Response: 'readonly',
  AbortSignal: 'readonly',
  AbortController: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  crypto: 'readonly',
}

/** 浏览器渲染器全局（src/desktop-shell/web/*.js）。 */
const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  URL: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  Uint8Array: 'readonly',
  AbortController: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  crypto: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  ResizeObserver: 'readonly',
  getComputedStyle: 'readonly',
}

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', '.runtime/', '.electron-builder-cache/', '.tmp/', '.tools/', 'release/', 'docs/active-context.html'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: { globals: NODE_GLOBALS, sourceType: 'commonjs' },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/desktop-shell/web/**/*.js'],
    languageOptions: { globals: BROWSER_GLOBALS },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
