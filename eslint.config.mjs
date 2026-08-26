import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'docs/active-context.html'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
)