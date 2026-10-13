import { z } from 'zod';

/** Relatório final do revisor: JSON puro, com achados que citam um ID de regra ou um gate. */
export const ReviewerReport = z
  .strictObject({
    status: z.enum(['approved', 'changes_requested']),
    findings: z.array(
      z.strictObject({
        ref: z.string().trim().min(1),
        message: z.string().trim().min(1),
      }),
    ),
  })
  .superRefine((report, ctx) => {
    if (report.status === 'approved' && report.findings.length)
      ctx.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'approved não pode ter achados',
      });
    if (report.status === 'changes_requested' && !report.findings.length)
      ctx.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'changes_requested exige ao menos um achado',
      });
  });
export type ReviewerReport = z.infer<typeof ReviewerReport>;

/** Valida a resposta do revisor; texto fora do JSON (prosa, cercas) é rejeitado. */
export function parseReviewerReport(text: string): ReviewerReport {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('relatório do revisor não é JSON puro');
  }
  const parsed = ReviewerReport.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `relatório do revisor inválido: ${parsed.error.issues.map((i) => `${i.path.join('.') || '.'}: ${i.message}`).join('; ')}`,
    );
  return parsed.data;
}
