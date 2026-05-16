import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readlinkSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import type { ProviderQuotaResult } from '../../domain/index.js';
import { ProviderUnavailableError } from '../base/index.js';
import { parseCodexRateLimitsResponse } from './rate-limits-parser.js';
import { readCodexRateLimitsFromWebSocket } from './live-rate-limits-probe.js';

export const CODEX_RATE_LIMITS_READ_METHOD = 'account/rateLimits/read';

type CodexRateLimitsReadMethod = typeof CODEX_RATE_LIMITS_READ_METHOD;

type CodexAppServerRequest = {
  id: string;
  method: CodexRateLimitsReadMethod;
  params: null;
};

export type CodexRateLimitsTransport = {
  readRateLimits(codexHome: string): Promise<unknown>;
};

export type CodexRateLimitsRawSender = {
  sendReadOnlyRequest(input: {
    codexHome: string;
    request: CodexAppServerRequest;
    timeoutMs: number;
  }): Promise<unknown>;
};

export type CodexRateLimitsProtocolTransportOptions = {
  timeoutMs?: number;
  requestId?: string;
};

export type FetchCodexRateLimitsOptions = {
  codexHome: string;
  accountEmail: string;
  fetchedAt: string;
};

export class CodexRateLimitsTransportError extends Error {
  constructor(message = 'Codex rate limit transport failed') {
    super(message);
    this.name = 'CodexRateLimitsTransportError';
  }
}

export class CodexRateLimitsTransportTimeoutError extends CodexRateLimitsTransportError {
  constructor(message = 'Codex rate limit transport timed out') {
    super(message);
    this.name = 'CodexRateLimitsTransportTimeoutError';
  }
}

export class UnsupportedCodexAppServerMethodError extends CodexRateLimitsTransportError {
  constructor(method: string) {
    super(`Unsupported Codex app-server method: ${method}`);
    this.name = 'UnsupportedCodexAppServerMethodError';
  }
}

export class CodexRateLimitsProtocolTransport implements CodexRateLimitsTransport {
  constructor(
    private readonly sender: CodexRateLimitsRawSender,
    private readonly options: CodexRateLimitsProtocolTransportOptions = {}
  ) {}

  readRateLimits(codexHome: string): Promise<unknown> {
    return this.sender.sendReadOnlyRequest({
      codexHome,
      request: createCodexRateLimitsRequest(CODEX_RATE_LIMITS_READ_METHOD, this.options.requestId),
      timeoutMs: this.options.timeoutMs ?? 5_000
    });
  }
}

export type CodexAppServerProcessStarter = {
  start(input: { codexHome: string; wsUrl: string }): ChildProcess;
};

export class NodeCodexAppServerProcessStarter implements CodexAppServerProcessStarter {
  start(input: { codexHome: string; wsUrl: string }): ChildProcess {
    return spawn(resolveCodexCommand(), ['app-server', '--listen', input.wsUrl], {
      env: { ...process.env, CODEX_HOME: input.codexHome },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
  }
}

function resolveCodexCommand(): string {
  const configured = process.env.AIQM_CODEX_BIN ?? process.env.CODEX_BIN;
  if (configured && existsSync(configured)) return configured;

  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry) continue;
    const candidate = join(entry, 'codex');
    if (existsSync(candidate)) return candidate;
  }

  // When aiqm runs via a symlink (e.g. ~/.local/bin/aiqm → ~/.nvm/.../bin/aiqm),
  // process.execPath may point to the system node rather than the nvm node. Follow
  // one symlink hop on process.argv[1] so we also check the nvm bin directory.
  if (process.argv[1]) {
    const besideScript = join(dirname(process.argv[1]), 'codex');
    if (existsSync(besideScript)) return besideScript;
    try {
      const target = readlinkSync(process.argv[1]);
      const resolved = isAbsolute(target) ? target : join(dirname(process.argv[1]), target);
      const besideTarget = join(dirname(resolved), 'codex');
      if (existsSync(besideTarget)) return besideTarget;
    } catch {
      // Not a symlink or unreadable — ignore
    }
  }

  const besideNode = join(dirname(process.execPath), 'codex');
  if (existsSync(besideNode)) return besideNode;

  return 'codex';
}

export class CodexLiveAppServerRateLimitsTransport implements CodexRateLimitsTransport {
  constructor(
    private readonly starter: CodexAppServerProcessStarter = new NodeCodexAppServerProcessStarter(),
    private readonly timeoutMs = 5_000
  ) {}

  async readRateLimits(codexHome: string): Promise<unknown> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const port = await findFreeLoopbackPort();
      const wsUrl = `ws://127.0.0.1:${String(port)}`;
      const child = this.starter.start({ codexHome, wsUrl });
      const stderr = collectChildStderr(child);
      const childError = collectChildError(child);
      try {
        await waitForLoopbackPort(port, this.timeoutMs, child, stderr, childError);
        return await readCodexRateLimitsFromWebSocket(wsUrl, this.timeoutMs);
      } catch (error) {
        lastError = error;
      } finally {
        await terminateChild(child);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ProviderUnavailableError('Codex app-server failed to start');
  }
}

export class StubCodexRateLimitsTransport implements CodexRateLimitsTransport {
  readonly calls: string[] = [];

  constructor(private readonly handler: (codexHome: string) => Promise<unknown>) {}

  async readRateLimits(codexHome: string): Promise<unknown> {
    this.calls.push(codexHome);
    return this.handler(codexHome);
  }
}

export function createCodexRateLimitsRequest(
  method: string,
  requestId = 'aiqm-codex-rate-limits-read'
): CodexAppServerRequest {
  if (method !== CODEX_RATE_LIMITS_READ_METHOD) {
    throw new UnsupportedCodexAppServerMethodError(method);
  }

  return {
    id: requestId,
    method: CODEX_RATE_LIMITS_READ_METHOD,
    params: null
  };
}

async function findFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address) resolve(address.port);
        else reject(new ProviderUnavailableError('Unable to allocate Codex app-server port'));
      });
    });
    server.on('error', reject);
  });
}

function waitForLoopbackPort(
  port: number,
  timeoutMs: number,
  child: ChildProcess,
  stderr: () => string,
  childError: () => Error | null
): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = (): void => {
      const startError = childError();
      if (startError) {
        reject(
          new ProviderUnavailableError(
            withStderr(`Codex app-server failed to start: ${startError.message}`, stderr)
          )
        );
        return;
      }
      if (child.exitCode !== null) {
        reject(
          new ProviderUnavailableError(
            withStderr('Codex app-server exited before listening', stderr)
          )
        );
        return;
      }
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(
            new ProviderUnavailableError(
              withStderr('Timed out waiting for Codex app-server', stderr)
            )
          );
          return;
        }
        setTimeout(tryConnect, 100);
      });
    };
    tryConnect();
  });
}

function collectChildError(child: ChildProcess): () => Error | null {
  let output: Error | null = null;
  child.once('error', (error: Error) => {
    output = error;
  });
  return () => output;
}

function collectChildStderr(child: ChildProcess): () => string {
  let output = '';
  const stream = child.stderr;
  stream?.setEncoding('utf8');
  stream?.on('data', (chunk: string) => {
    output = `${output}${chunk}`.slice(-2_000);
  });
  return () => output.trim();
}

function withStderr(message: string, stderr: () => string): string {
  const text = stderr();
  return text ? `${message}: ${text}` : message;
}

function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimeout);
      clearTimeout(giveUpTimeout);
      resolve();
    };
    const forceKillTimeout = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 1_000);
    const giveUpTimeout = setTimeout(settle, 2_000);

    child.once('close', settle);
    child.once('exit', settle);
    child.kill('SIGTERM');
  });
}

export async function fetchCodexRateLimitsWithTransport(
  transport: CodexRateLimitsTransport,
  options: FetchCodexRateLimitsOptions
): Promise<ProviderQuotaResult> {
  try {
    const response = await transport.readRateLimits(options.codexHome);
    return parseCodexRateLimitsResponse(response, {
      accountEmail: options.accountEmail,
      fetchedAt: options.fetchedAt
    });
  } catch (error) {
    if (error instanceof CodexRateLimitsTransportTimeoutError) {
      throw new ProviderUnavailableError('Codex rate limit transport timed out');
    }
    if (error instanceof CodexRateLimitsTransportError) {
      throw new ProviderUnavailableError('Codex rate limit transport failed');
    }
    throw error;
  }
}
