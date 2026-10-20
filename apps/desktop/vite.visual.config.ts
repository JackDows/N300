import {defineConfig,mergeConfig} from 'vite';
import desktop from './vite.config.ts';

export default mergeConfig(desktop,defineConfig({
  base:'./',
  build:{outDir:'../../artifacts/visual/preview',emptyOutDir:false,rolldownOptions:{input:'visual.html'}},
  preview:{host:'127.0.0.1',port:1421,strictPort:true},
}));
