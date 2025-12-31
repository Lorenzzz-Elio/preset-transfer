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
        /^\/script\.js$/,  // 外部化 SillyTavern 主入口（用于动态 import('/script.js')）
      ],
      output: {
        inlineDynamicImports: true,
      },
    },
    cssCodeSplit: false,
  },
});
