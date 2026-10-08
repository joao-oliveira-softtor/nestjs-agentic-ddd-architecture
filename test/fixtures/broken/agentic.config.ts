import { defineConfig } from '@agentic-ddd/compiler';

export default defineConfig({
  modules: [{ name: 'broken', path: 'domain' }],
});
