import { formatCoded } from '../contracts/codes';

export interface ArgSpec {
  readonly booleans: readonly string[];
  readonly values: readonly string[];
  readonly positionals: number;
}

export interface ParsedArgs {
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
  readonly positionals: readonly string[];
}

export function parseArgs(
  args: readonly string[],
  spec: ArgSpec,
): ParsedArgs | string {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (spec.booleans.includes(arg)) {
      flags.add(arg);
    } else if (spec.values.includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--'))
        return formatCoded({
          code: 'cli.option-value-required',
          message: `${arg} requires a value`,
        });
      values.set(arg, value);
    } else if (arg.startsWith('--')) {
      return formatCoded({
        code: 'cli.option-unknown',
        message: `unknown option: ${arg}`,
      });
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== spec.positionals) {
    return formatCoded({
      code: 'cli.argument-count',
      message: `expected ${spec.positionals} argument(s), received ${positionals.length}`,
    });
  }
  return { flags, values, positionals };
}
