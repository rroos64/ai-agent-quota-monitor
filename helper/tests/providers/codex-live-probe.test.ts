// Provenance: docs/test-traceability.md — Providers area
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CODEX_RATE_LIMITS_READ_METHOD,
  ProviderUnavailableError,
  runCodexLiveRateLimitsProbe,
  type CodexProbeWebSocket,
  type CodexProbeWebSocketFactory,
  type CodexProbeWebSocketMessageEvent,
  type CodexProxyChildProcess,
  type CodexProxyProcessStarter
} from '../../src/providers/index.js';

const oldEnv = process.env.AIQM_ENABLE_CODEX_LIVE_PROBE;
const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

function fixtureResponse(): unknown {
  return {
    jsonrpc: '2.0',
    id: 'aiqm-codex-rate-limits-read',
    result: {
      rateLimits: {
        limitId: 'codex',
        limitName: 'Codex',
        primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1778682600 },
        secondary: { usedPercent: 68, windowDurationMins: 10080, resetsAt: 1779028200 },
        credits: { hasCredits: true, unlimited: false, balance: secretSentinel },
        planType: 'plus',
        rateLimitReachedType: null
      },
      rateLimitsByLimitId: null
    }
  };
}

function initializeResponse(id: unknown): string {
  return `${JSON.stringify({
    id,
    result: {
      userAgent: 'codex-test',
      codexHome: '/tmp/redacted',
      platformFamily: 'unix',
      platformOs: 'linux'
    }
  })}\n`;
}

class FakeProxyProcess extends EventEmitter implements CodexProxyChildProcess {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly writes: string[] = [];
  ended = false;
  killed = false;

  constructor(private readonly onWrite: (process: FakeProxyProcess, frame: unknown) => void) {
    super();
  }

  readonly stdin = {
    write: (chunk: string | Buffer): boolean => {
      const text = chunk.toString();
      this.writes.push(text);
      this.onWrite(this, JSON.parse(text.trim()) as unknown);
      return true;
    },
    end: (): void => {
      this.ended = true;
    }
  };

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

class FakeWebSocket implements CodexProbeWebSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, ((event?: unknown) => void)[]>();

  constructor(private readonly onSend: (socket: FakeWebSocket, frame: unknown) => void) {}

  send(data: string): void {
    this.sent.push(data);
    this.onSend(this, JSON.parse(data) as unknown);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(event: 'open', listener: () => void): void;
  addEventListener(
    event: 'message',
    listener: (event: CodexProbeWebSocketMessageEvent) => void
  ): void;
  addEventListener(event: 'error' | 'close', listener: (event: unknown) => void): void;
  addEventListener(event: string, listener: (event?: unknown) => void): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  emitOpen(): void {
    this.emit('open');
  }

  emitMessage(data: string): void {
    this.emit('message', { data });
  }

  private emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

class FakeWebSocketFactory implements CodexProbeWebSocketFactory {
  socket?: FakeWebSocket;
  urls: string[] = [];

  constructor(private readonly onSend: (socket: FakeWebSocket, frame: unknown) => void) {}

  connect(url: string): CodexProbeWebSocket {
    this.urls.push(url);
    this.socket = new FakeWebSocket(this.onSend);
    queueMicrotask(() => this.socket?.emitOpen());
    return this.socket;
  }
}

class FakeStarter implements CodexProxyProcessStarter {
  process?: FakeProxyProcess;

  constructor(private readonly onWrite: (process: FakeProxyProcess, frame: unknown) => void) {}

  start(): CodexProxyChildProcess {
    const process = new FakeProxyProcess(this.onWrite);
    this.process = process;
    return process;
  }
}

async function withLiveProbeEnabled<T>(fn: () => Promise<T>): Promise<T> {
  process.env.AIQM_ENABLE_CODEX_LIVE_PROBE = '1';
  try {
    return await fn();
  } finally {
    if (oldEnv === undefined) delete process.env.AIQM_ENABLE_CODEX_LIVE_PROBE;
    else process.env.AIQM_ENABLE_CODEX_LIVE_PROBE = oldEnv;
  }
}

function handshakeStarter(): FakeStarter {
  return new FakeStarter((process, frame) => {
    const request = frame as Record<string, unknown>;
    if (request.method === 'initialize') {
      queueMicrotask(() => process.stdout.emit('data', initializeResponse(request.id)));
    }
    if (request.method === CODEX_RATE_LIMITS_READ_METHOD) {
      queueMicrotask(() => process.stdout.emit('data', `${JSON.stringify(fixtureResponse())}\n`));
    }
  });
}

// Traceability: CODEX-LIVE-PROBE-HANDSHAKE-001 hidden opt-in probe path uses only a fake proxy process in tests, sends initialize/initialized before exactly one account/rateLimits/read, and persists redacted evidence only.
describe('runCodexLiveRateLimitsProbe', () => {
  it('is disabled unless AIQM_ENABLE_CODEX_LIVE_PROBE=1', async () => {
    delete process.env.AIQM_ENABLE_CODEX_LIVE_PROBE;

    await expect(
      runCodexLiveRateLimitsProbe(
        {
          codexHome: '/tmp/codex-home',
          socketPath: '/tmp/app.sock',
          accountEmail: 'codex-user@example.test',
          fetchedAt: '2026-05-13T12:00:00.000Z'
        },
        new FakeStarter(() => undefined)
      )
    ).rejects.toThrow('Codex live probe is disabled');
  });

  it('performs handshake, sends one allowlisted rate-limit request, and returns redacted parsed evidence', async () => {
    const starter = handshakeStarter();

    const evidence = await withLiveProbeEnabled(() =>
      runCodexLiveRateLimitsProbe(
        {
          codexHome: '/tmp/codex-home',
          socketPath: '/tmp/app.sock',
          accountEmail: 'codex-user@example.test',
          fetchedAt: '2026-05-13T12:00:00.000Z'
        },
        starter
      )
    );

    expect(starter.process?.writes).toHaveLength(3);
    const frames = (starter.process?.writes ?? []).map(
      (write) => JSON.parse(write) as Record<string, unknown>
    );
    expect(frames.map((frame) => frame.method)).toEqual([
      'initialize',
      'initialized',
      CODEX_RATE_LIMITS_READ_METHOD
    ]);
    expect(frames[0]).toMatchObject({
      id: 'aiqm-initialize',
      method: 'initialize',
      params: {
        clientInfo: { name: 'aiqm', title: 'AIQM Codex rate limit probe', version: '1.1.0' },
        capabilities: { experimentalApi: true, optOutNotificationMethods: [] }
      }
    });
    expect(frames[1]).toEqual({ method: 'initialized' });
    expect(frames[2]).toEqual({
      id: 'aiqm-codex-rate-limits-read',
      method: CODEX_RATE_LIMITS_READ_METHOD,
      params: null
    });
    expect(evidence).toMatchObject({
      probe: 'codex-app-server-rate-limits-read',
      method: CODEX_RATE_LIMITS_READ_METHOD,
      requestSent: true,
      rawFramesPersisted: false,
      frameSummary: { responseFramesSeen: 2 },
      parsed: { provider: 'codex', status: 'fresh' }
    });
    expect(JSON.stringify(evidence)).not.toContain(secretSentinel);
    expect(JSON.stringify(evidence)).not.toContain('/tmp/app.sock');
    expect(JSON.stringify(evidence)).not.toContain('/tmp/codex-home');
  });

  it('writes only redacted evidence when output path is supplied', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiqm-codex-live-probe-test-'));
    const out = join(dir, 'evidence.json');
    const starter = handshakeStarter();

    await withLiveProbeEnabled(() =>
      runCodexLiveRateLimitsProbe(
        {
          codexHome: '/tmp/codex-home',
          socketPath: '/tmp/app.sock',
          accountEmail: 'codex-user@example.test',
          fetchedAt: '2026-05-13T12:00:00.000Z',
          outputPath: out
        },
        starter
      )
    );

    const text = readFileSync(out, 'utf8');
    expect(text).toContain('codex-app-server-rate-limits-read');
    expect(text).not.toContain(secretSentinel);
    expect(text).not.toContain('/tmp/app.sock');
    expect(text).not.toContain('/tmp/codex-home');
  });

  it('fails safely if the server does not respond to initialize', async () => {
    await expect(
      withLiveProbeEnabled(() =>
        runCodexLiveRateLimitsProbe(
          {
            codexHome: '/tmp/codex-home',
            socketPath: '/tmp/app.sock',
            accountEmail: 'codex-user@example.test',
            fetchedAt: '2026-05-13T12:00:00.000Z',
            timeoutMs: 1
          },
          new FakeStarter(() => undefined)
        )
      )
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('supports loopback WebSocket transport with the same handshake and rate-limit allowlist', async () => {
    const wsFactory = new FakeWebSocketFactory((socket, frame) => {
      const request = frame as Record<string, unknown>;
      if (request.method === 'initialize') {
        queueMicrotask(() => socket.emitMessage(initializeResponse(request.id)));
      }
      if (request.method === CODEX_RATE_LIMITS_READ_METHOD) {
        queueMicrotask(() => {
          socket.emitMessage(
            JSON.stringify({ method: 'remoteControl/status/changed', params: {} })
          );
          socket.emitMessage(JSON.stringify(fixtureResponse()));
        });
      }
    });

    const evidence = await withLiveProbeEnabled(() =>
      runCodexLiveRateLimitsProbe(
        {
          codexHome: '/tmp/codex-home',
          wsUrl: 'ws://127.0.0.1:18080',
          accountEmail: 'codex-user@example.test',
          fetchedAt: '2026-05-13T12:00:00.000Z'
        },
        new FakeStarter(() => undefined),
        wsFactory
      )
    );

    expect(wsFactory.urls).toEqual(['ws://127.0.0.1:18080']);
    const frames = (wsFactory.socket?.sent ?? []).map(
      (write) => JSON.parse(write) as Record<string, unknown>
    );
    expect(frames.map((frame) => frame.method)).toEqual([
      'initialize',
      'initialized',
      CODEX_RATE_LIMITS_READ_METHOD
    ]);
    expect(evidence).toMatchObject({
      transport: 'websocket',
      command: { executable: 'websocket', args: ['<redacted-ws-url>'] },
      frameSummary: { responseFramesSeen: 3 },
      parsed: { provider: 'codex', status: 'fresh' }
    });
    expect(JSON.stringify(evidence)).not.toContain(secretSentinel);
    expect(JSON.stringify(evidence)).not.toContain('ws://127.0.0.1:18080');
  });

  it('rejects non-loopback or conflicting WebSocket live probe inputs', async () => {
    await expect(
      withLiveProbeEnabled(() =>
        runCodexLiveRateLimitsProbe(
          {
            codexHome: '/tmp/codex-home',
            wsUrl: 'wss://example.test:18080',
            accountEmail: 'codex-user@example.test',
            fetchedAt: '2026-05-13T12:00:00.000Z'
          },
          new FakeStarter(() => undefined),
          new FakeWebSocketFactory(() => undefined)
        )
      )
    ).rejects.toThrow('--ws-url must be a loopback ws:// URL');

    await expect(
      withLiveProbeEnabled(() =>
        runCodexLiveRateLimitsProbe(
          {
            codexHome: '/tmp/codex-home',
            socketPath: '/tmp/app.sock',
            wsUrl: 'ws://127.0.0.1:18080',
            accountEmail: 'codex-user@example.test',
            fetchedAt: '2026-05-13T12:00:00.000Z'
          },
          new FakeStarter(() => undefined),
          new FakeWebSocketFactory(() => undefined)
        )
      )
    ).rejects.toThrow('Use either --socket or --ws-url, not both');
  });

  it('does not continue if a server returns rate limits before initialize completes', async () => {
    await expect(
      withLiveProbeEnabled(() =>
        runCodexLiveRateLimitsProbe(
          {
            codexHome: '/tmp/codex-home',
            socketPath: '/tmp/app.sock',
            accountEmail: 'codex-user@example.test',
            fetchedAt: '2026-05-13T12:00:00.000Z'
          },
          new FakeStarter((process, frame) => {
            const request = frame as Record<string, unknown>;
            if (request.method === 'initialize') {
              process.stdout.emit('data', `${JSON.stringify(fixtureResponse())}\n`);
            }
          })
        )
      )
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
