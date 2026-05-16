// Provenance: docs/test-traceability.md — Providers area
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthRequiredError } from '../../src/domain/index.js';
import {
  CODEX_RATE_LIMITS_READ_METHOD,
  CodexLiveAppServerRateLimitsTransport,
  CodexRateLimitsProtocolTransport,
  CodexRateLimitsTransportError,
  CodexRateLimitsTransportTimeoutError,
  ProviderShapeChangedError,
  ProviderUnavailableError,
  StubCodexRateLimitsTransport,
  UnsupportedCodexAppServerMethodError,
  createCodexRateLimitsRequest,
  fetchCodexRateLimitsWithTransport,
  type CodexAppServerProcessStarter,
  type CodexRateLimitsRawSender
} from '../../src/providers/index.js';

const codexHome = '/tmp/redacted-codex-home';
const accountEmail = 'codex-user@example.test';
const fetchedAt = '2026-05-13T12:00:00.000Z';
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

class FakeCodexChild extends EventEmitter {
  readonly stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  exitCode: number | null = null;
  readonly killedSignals: string[] = [];

  kill(signal = 'SIGTERM'): boolean {
    this.killedSignals.push(signal);
    this.exitCode = 0;
    setImmediate(() => this.emit('close', 0, signal));
    return true;
  }
}

function fixture(): unknown {
  const path = resolve(
    process.cwd(),
    '../fixtures/providers/codex/quota-success.redacted.example.json'
  );
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function fetchWith(transport: StubCodexRateLimitsTransport) {
  return fetchCodexRateLimitsWithTransport(transport, { codexHome, accountEmail, fetchedAt });
}

// Traceability: CODEX-TRANSPORT-001 controlled, stub-friendly Codex rate-limit transport boundary; no live Codex process, no generic app-server send, and only account/rateLimits/read is allowlisted.
describe('Codex rate limits transport boundary', () => {
  it('fetches through a stub transport and normalizes with the existing parser', async () => {
    const transport = new StubCodexRateLimitsTransport(() => Promise.resolve(fixture()));

    await expect(fetchWith(transport)).resolves.toMatchObject({
      provider: 'codex',
      accountEmail,
      fetchedAt,
      status: 'fresh',
      windows: [
        { id: 'codex:5h', providerWindowName: '5-hour Codex limit' },
        { id: 'codex:weekly', providerWindowName: 'Weekly Codex limit' }
      ]
    });
    expect(transport.calls).toEqual([codexHome]);
  });

  it('propagates auth-required and malformed response errors without wrapping parser failures', async () => {
    await expect(
      fetchWith(
        new StubCodexRateLimitsTransport(() => Promise.resolve({ status: 'auth_required' }))
      )
    ).rejects.toBeInstanceOf(AuthRequiredError);

    await expect(
      fetchWith(new StubCodexRateLimitsTransport(() => Promise.resolve({ rateLimits: null })))
    ).rejects.toBeInstanceOf(ProviderShapeChangedError);
  });

  it('maps timeout and transport failures to provider unavailable without leaking raw protocol data', async () => {
    await expect(
      fetchWith(
        new StubCodexRateLimitsTransport(() =>
          Promise.reject(new CodexRateLimitsTransportTimeoutError(secretSentinel))
        )
      )
    ).rejects.toMatchObject({
      name: 'ProviderUnavailableError',
      message: 'Codex rate limit transport timed out'
    });

    await expect(
      fetchWith(
        new StubCodexRateLimitsTransport(() =>
          Promise.reject(new CodexRateLimitsTransportError(secretSentinel))
        )
      )
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    try {
      await fetchWith(
        new StubCodexRateLimitsTransport(() =>
          Promise.reject(new CodexRateLimitsTransportError(secretSentinel))
        )
      );
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secretSentinel);
      expect(error).toMatchObject({ message: 'Codex rate limit transport failed' });
    }
  });

  it('builds only the allowlisted account/rateLimits/read request for protocol senders', async () => {
    const calls: unknown[] = [];
    const sender: CodexRateLimitsRawSender = {
      sendReadOnlyRequest: (input) => {
        calls.push(input);
        return Promise.resolve(fixture());
      }
    };
    const transport = new CodexRateLimitsProtocolTransport(sender, {
      requestId: 'test-request-1',
      timeoutMs: 1234
    });

    await expect(
      fetchCodexRateLimitsWithTransport(transport, { codexHome, accountEmail, fetchedAt })
    ).resolves.toMatchObject({ status: 'fresh' });
    expect(calls).toEqual([
      {
        codexHome,
        timeoutMs: 1234,
        request: { id: 'test-request-1', method: CODEX_RATE_LIMITS_READ_METHOD, params: null }
      }
    ]);
  });

  it('blocks unsupported app-server methods at the request boundary', () => {
    expect(createCodexRateLimitsRequest(CODEX_RATE_LIMITS_READ_METHOD)).toEqual({
      id: 'aiqm-codex-rate-limits-read',
      method: CODEX_RATE_LIMITS_READ_METHOD,
      params: null
    });
    expect(() => createCodexRateLimitsRequest('thread/start')).toThrow(
      UnsupportedCodexAppServerMethodError
    );
  });

  it('terminates Codex app-server child processes when a live transport attempt times out', async () => {
    const children: FakeCodexChild[] = [];
    const starter: CodexAppServerProcessStarter = {
      start: () => {
        const child = new FakeCodexChild();
        children.push(child);
        return child as never;
      }
    };
    const transport = new CodexLiveAppServerRateLimitsTransport(starter, 1);

    await expect(transport.readRateLimits(codexHome)).rejects.toBeInstanceOf(
      ProviderUnavailableError
    );
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((child) => child.killedSignals.includes('SIGTERM'))).toBe(true);
  });

  it('does not expose raw protocol payloads through transport error mapping', async () => {
    const transport = new StubCodexRateLimitsTransport(() =>
      Promise.reject(
        new CodexRateLimitsTransportError(
          JSON.stringify({ token: secretSentinel, method: CODEX_RATE_LIMITS_READ_METHOD })
        )
      )
    );

    await expect(fetchWith(transport)).rejects.toMatchObject({
      name: 'ProviderUnavailableError',
      message: 'Codex rate limit transport failed'
    });
  });
});
