import { expect, test } from 'bun:test';
import { DOMAIN_CORE, REVIEWER_CORE, ROLE_CORES } from './briefs';

test('the role cores resolve from the shipped skill and are non-empty', () => {
  expect(DOMAIN_CORE).toContain('skills');
  expect(REVIEWER_CORE).toContain('skills');
  for (const core of Object.values(ROLE_CORES)) expect(core.length).toBeGreaterThan(0);
});
