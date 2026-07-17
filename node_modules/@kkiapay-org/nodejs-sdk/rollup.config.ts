import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

export default {
  input: 'lib/index.ts',
  output: [
    {
      file: 'dist/lib/index.js',
      format: 'cjs',
      plugins: [terser()],
    },
    {
      file: 'dist/lib/index.es.js',
      format: 'es',
      plugins: [terser()],
    },
  ],
  plugins: [typescript()],
};
