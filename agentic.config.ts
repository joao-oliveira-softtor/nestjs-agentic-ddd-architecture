import { defineConfig } from '@agentic-ddd/compiler';

export default defineConfig({
  modules: [{ name: 'orders', path: 'examples/orders' }],
  verify: {
    // Framework + orders. test/evals-* runs only in the outer suite; the
    // scope test in test/evals-verification-scope.test.ts keeps this list
    // in sync with test/.
    test: [
      'bun',
      'test',
      './src',
      './examples/orders',
      './test/agent-briefs.test.ts',
      './test/app.test.ts',
      './test/architecture.test.ts',
      './test/boundary-gates.test.ts',
      './test/evals.test.ts',
      './test/executor-roles.test.ts',
      './test/mcp.test.ts',
      './test/orchestrate.test.ts',
      './test/package-audit.test.ts',
      './test/package-transform.test.ts',
      './test/package.test.ts',
      './test/reviewer-report.test.ts',
      './test/skills-example.test.ts',
      './test/skills-install.test.ts',
    ],
  },
});
