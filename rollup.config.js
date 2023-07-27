import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import nodePolyfills from 'rollup-plugin-polyfill-node';
// import builtins from 'rollup-plugin-node-builtins';
import pkg from './package.json'

export default [
  // UMD for browser-friendly build
  {
    input: 'src/index.ts',
    output: {
      name: 'wk',
			file: pkg.browser,
			format: 'umd',
    },
    plugins: [
      // nodePolyfills(),
      resolve({
        browser: true,
        preferBuiltins: false,
      }),
      // builtins(),
      commonjs(),
      typescript({
        exclude: ['node_modules/**'],
        rootDir: './src',
      })
    ],
  },
  // CommonJS for Node and ES module for bundlers build
  {
    input: 'src/index.ts',
    external: ['ms'],
    plugins: [
      typescript({
        exclude: ['node_modules/**'],
        rootDir: './src',
      })
    ],
    output: [
      {  file: pkg.main, format: 'cjs' },
      {  file: pkg.module, format: 'es' }
    ]
  }
]

