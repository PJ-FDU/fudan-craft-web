import { defineConfig,loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig(({mode})=>{
  const pages=mode==='pages';
  if(pages){
    const env=loadEnv(mode,process.cwd(),'VITE_');
    if(!/^pk_live_[A-Za-z0-9_-]+$/.test(env.VITE_METERED_PUBLISHABLE_KEY??'')){
      throw new Error('Pages 构建需要 VITE_METERED_PUBLISHABLE_KEY（Metered pk_live_ 公钥）。');
    }
  }
  return {
    base:pages?'./':'/',
    define:{__PAGES_BUILD__:JSON.stringify(pages)},
    // Worker 在 Rollup 摇树前由 Vite 处理；服务器构建先替换静态版入口。
    resolve:{alias:pages?[]:[{find:'./network/p2p-connection.js',replacement:fileURLToPath(new URL('./src/network/server-only.ts',import.meta.url))}]},
    build:{target:'es2022',outDir:pages?'dist-pages':'dist'},
    worker:{format:'es'},
    server:{host:'0.0.0.0'},
  };
});
