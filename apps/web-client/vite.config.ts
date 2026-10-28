import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Keep WalletConnect's ephemeral Core out of the SDK's global cache.
  define: { 'process.env.DISABLE_GLOBAL_CORE': JSON.stringify('true') },
  server: {
    watch: { ignored: ['**/dist-signer/**', '**/release/**'] },
    proxy: {
      '/api': { target: 'https://haatz.quilibrium.com', changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') },
    },
  },
  build: { target: 'es2022' },
});
