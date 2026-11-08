export const USAGE = [
  'usage:',
  '  agentic-ddd compile [--check] [--report] [--draft-change <slug>] [--config <file>] [--out-root <dir>]',
  '  agentic-ddd apply <bundle-dir> [--yes] [--root <dir>]   (without --yes: lists the files, writes nothing; the bundle hash proves integrity, not authenticity; applying runs the code of the bundle during compile, so apply only trusted bundles; writes only under module paths and one changes/NNNN-slug)',
  '  agentic-ddd ir [--config <file>]',
  '  agentic-ddd status [--json] [--static] [--change NNNN] [--config <file>]',
  '  agentic-ddd next [--json] [--change NNNN] [--config <file>]',
  '  agentic-ddd packet <item> [--static] [--config <file>]',
  '  agentic-ddd verify --item <item> --spec-hash <hash> [--json] [--config <file>]',
  '  agentic-ddd verify <NNNN> [--json] [--config <file>]',
  '  agentic-ddd mcp [--root <dir>] [--config <file>] [--published <file> [--expect-digest <sha256>]] [--http [--port <n>] [--host <addr>]]',
  '  agentic-ddd publish-lock --version <v> --out <file> [--root <dir>]',
].join('\n');
