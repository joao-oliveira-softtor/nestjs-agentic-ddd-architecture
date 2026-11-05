import { expect, test } from 'bun:test';
import {
  DOMAIN_CORE,
  REVIEWER_CORE,
  ROLE_CORES,
  briefFileName,
  firstBriefClash,
} from './briefs';

test('the role cores resolve from the shipped skill and are non-empty', () => {
  expect(DOMAIN_CORE).toContain('skills');
  expect(REVIEWER_CORE).toContain('skills');
  for (const core of Object.values(ROLE_CORES)) expect(core.length).toBeGreaterThan(0);
});

test('brief file names keep underscores and map the rest to dashes', () => {
  expect(briefFileName('method:Order.cancel')).toBe('method-Order-cancel.md');
});

test('finds the first item that would overwrite the brief of another', () => {
  expect(firstBriefClash(['usecase:a_b', 'usecase:a__b'])).toBeUndefined();
  expect(firstBriefClash(['entity:A.b', 'entity:A:b', 'entity:C'])).toEqual({
    id: 'entity:A:b',
    other: 'entity:A.b',
    name: 'entity-A-b.md',
  });
});
