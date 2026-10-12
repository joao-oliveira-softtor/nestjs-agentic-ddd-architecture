// Preloaded into every `bun test` that runs submitted code (executor suite and
// private oracle). The submitted module shares that process: any of these
// calls ends it before Bun writes its own JUnit and final summary, leaving in
// their place a report the module forged. Blocked, they throw inside the run.
// Same-process code can still tamper with the test runtime in other ways; see
// "Descobertas novas" (D2) in docs/superpowers/plans/2026-10-12-code-review-fixes.md.
const blocked = (name: string) => (): never => {
  throw new Error(`${name} is disabled during evaluation`);
};
const kill = process.kill.bind(process);
function lock(name: string, value: unknown) {
  Object.defineProperty(process, name, {
    value,
    writable: false,
    configurable: false,
  });
}
lock('exit', blocked('process.exit'));
lock('reallyExit', blocked('process.reallyExit'));
lock('abort', blocked('process.abort'));
lock('_kill', blocked('process._kill'));
lock('kill', (pid: number, signal?: string | number) =>
  Number(pid) <= 0 || Number(pid) === process.pid
    ? blocked('process.kill of this process')()
    : kill(pid, signal),
);
export {};
