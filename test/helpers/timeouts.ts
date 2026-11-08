// shortcut: CLI-spawning tests run up to ~9 bun spawns (~4 s alone); 30 s absorbs machine load, raise only if measured slower.
export const CLI_TEST_TIMEOUT_MS = 30_000;
