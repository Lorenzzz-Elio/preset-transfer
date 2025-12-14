import { defineConfig } from 'vite';

export default defineConfig({
  css: {
    postcss: false,
  },
  build: {
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: [
        /^\.\.\/\.\.\/\.\.\//,  // 外部化所有 SillyTavern 的导入
        /^\/scripts\//,  // 外部化 /scripts/ 开头的导入
      ],
      output: {
        inlineDynamicImports: true,
      },
    },
    cssCodeSplit: false,
  },
});
