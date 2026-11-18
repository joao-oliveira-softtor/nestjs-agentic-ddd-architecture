import { expect, test } from 'bun:test';
import { OperatorRuntime } from '@agentic-ddd/runtime';
import { FakeLlm } from '@agentic-ddd/testing';
import { createRuntimeMcpHandler } from './runtime-http';

test('refuses insecure URLs, credentials in the public URL and ambiguous scope names at startup', () => {
  const runtime = new OperatorRuntime({ modules: [], llm: new FakeLlm([]) });
  const options = {
    issuer: 'https://auth.example',
    resource: 'https://runtime.example/mcp',
    operatorAllowlist: ['agent'],
  };
  for (const invalid of [
    { resource: 'https://runtime.example/other' },
    { resource: 'https://runtime.example/mcp/' },
    { resource: 'http://runtime.example/mcp' },
    { resource: 'https://user:pass@runtime.example/mcp' },
    // JavaScript callers can omit the issuer even when the TypeScript type requires it.
    {
      issuer: undefined as unknown as string,
      jwksUri: 'https://auth.example/keys',
    },
    { issuer: 'https://user:password@auth.example' },
    { issuer: 'https://auth.example?tenant=A' },
    { issuer: 'http://auth.example' },
    { jwksUri: 'http://auth.example/keys' },
    { operatorAllowlist: ['foo:bar'] },
  ]) {
    expect(() =>
      createRuntimeMcpHandler(runtime, { ...options, ...invalid }),
    ).toThrow();
  }
});
