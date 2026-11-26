import {fileURLToPath} from 'node:url';

const config = {
  outputFileTracingRoot: fileURLToPath(new URL('.',import.meta.url)),
  distDir: process.env.FINCORE_BUILD_DIR || '.next',
  async rewrites() {
    return [{source:'/api/v1/:path*',destination:(process.env.API_URL || 'http://127.0.0.1:4000')+'/api/v1/:path*'}];
  }
};
export default config;
