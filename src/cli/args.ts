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
        return `${arg} exige um valor`;
      values.set(arg, value);
    } else if (arg.startsWith('--')) {
      return `opção desconhecida: ${arg}`;
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== spec.positionals) {
    return `esperado ${spec.positionals} argumento(s), recebido ${positionals.length}`;
  }
  return { flags, values, positionals };
}
