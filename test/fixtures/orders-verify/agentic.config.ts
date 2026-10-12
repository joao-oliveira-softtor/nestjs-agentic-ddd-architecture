import { defineConfig } from '@agentic-ddd/compiler';

// The real project with only the domain tests in the nested collection, so
// src/cli/verify.test.ts checks the gates of 0001/0002 without rerunning the
// whole suite. The root agentic.config.ts keeps the full verify scope.
export default defineConfig({
  root: '../../..',
  modules: [{ name: 'orders', path: 'examples/orders' }],
  verify: { test: ['bun', 'test', './examples/orders'] },
});
