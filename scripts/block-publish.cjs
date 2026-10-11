console.error(
  'npm publication is blocked: validate the final package name, registry availability and account/scope publish permissions, then deliberately remove this gate.',
);
process.exitCode = 1;
