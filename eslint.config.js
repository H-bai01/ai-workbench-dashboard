import pluginVue from 'eslint-plugin-vue'
import ts from 'typescript-eslint'
import pluginUnusedImports from 'eslint-plugin-unused-imports'

export default [
  { ignores: ['dist/', 'node_modules/', '.vite-cache/', 'backups/', '*.d.ts'] },
  // Vue recommended rules
  ...pluginVue.configs['flat/recommended'],
  // Override for .vue files
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': ts.plugin,
      'unused-imports': pluginUnusedImports,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'vue/block-order': ['error', { order: ['template', 'script', 'style'] }],
      'vue/no-multiple-template-root': 'off',
      'vue/multi-word-component-names': 'warn',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/attributes-order': 'off',
      'vue/html-self-closing': 'off',
    },
  },
  // TypeScript files
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: ts.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': ts.plugin,
      'unused-imports': pluginUnusedImports,
    },
    rules: {
      ...ts.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
]
