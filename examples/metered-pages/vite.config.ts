import { defineConfig } from 'vite';

export default defineConfig({
  // 本例没有路径路由；相对资源路径同时适用于仓库 Pages 和用户主页 Pages。
  base: './',
  build: { target: 'es2022' },
});
