import { expect, test } from 'bun:test';
import { ROLE_CORES } from '../scripts/agent-briefs';
import { parseReviewerReport } from '../scripts/reviewer-report';

test('relatório válido: aprovado sem achados e mudanças com achados', () => {
  expect(parseReviewerReport('{"status":"approved","findings":[]}')).toEqual({
    status: 'approved',
    findings: [],
  });
  expect(
    parseReviewerReport(
      '{"status":"changes_requested","findings":[{"ref":"I4","message":"o teste não exercita a regra"}]}',
    ).findings,
  ).toEqual([{ ref: 'I4', message: 'o teste não exercita a regra' }]);
});

test('o exemplo do núcleo do revisor é um relatório válido', () => {
  const example = /no formato do exemplo: `(\{.*?\})`\./.exec(
    ROLE_CORES.reviewer,
  )![1]!;
  expect(parseReviewerReport(example).status).toBe('changes_requested');
});

test('rejeita prosa, cercas, chaves extras e combinações incoerentes', () => {
  expect(() => parseReviewerReport('ok\n{"status":"approved"}')).toThrow(
    'não é JSON puro',
  );
  expect(() =>
    parseReviewerReport('```json\n{"status":"approved","findings":[]}\n```'),
  ).toThrow('não é JSON puro');
  expect(() =>
    parseReviewerReport('{"status":"approved","findings":[],"extra":1}'),
  ).toThrow('inválido');
  expect(() =>
    parseReviewerReport('{"status":"talvez","findings":[]}'),
  ).toThrow('status');
  expect(() =>
    parseReviewerReport(
      '{"status":"approved","findings":[{"ref":"I4","message":"x"}]}',
    ),
  ).toThrow('approved não pode ter achados');
  expect(() =>
    parseReviewerReport('{"status":"changes_requested","findings":[]}'),
  ).toThrow('exige ao menos um achado');
});

test('achado sem ID de regra ou gate (ref vazio) é rejeitado', () => {
  expect(() =>
    parseReviewerReport(
      '{"status":"changes_requested","findings":[{"ref":" ","message":"x"}]}',
    ),
  ).toThrow('findings.0.ref');
  expect(() =>
    parseReviewerReport(
      '{"status":"changes_requested","findings":[{"ref":"I4","message":""}]}',
    ),
  ).toThrow('findings.0.message');
});
