import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { Socket } from 'node:net';
import type { Readable, Writable } from 'node:stream';
import { redactSecrets } from '../../diagnostics/index.js';
import type { ProviderQuotaResult } from '../../domain/index.js';
import { ProviderUnavailableError } from '../base/index.js';
import {
  CODEX_RATE_LIMITS_READ_METHOD,
  createCodexRateLimitsRequest
} from './rate-limits-transport.js';
import { parseCodexRateLimitsResponse } from './rate-limits-parser.js';

export type CodexLiveRateLimitsProbeInput = {
  codexHome: string;
  socketPath?: string;
  wsUrl?: string;
  accountEmail: string;
  fetchedAt: string;
  timeoutMs?: number;
  outputPath?: string;
};

export type CodexLiveRateLimitsProbeEvidence = {
  schemaVersion: '1';
  probe: 'codex-app-server-rate-limits-read';
  transport: 'socket-proxy' | 'websocket';
  command: {
    executable: 'codex' | 'websocket';
    args: ['app-server', 'proxy', '--sock', '<redacted-socket-path>'] | ['<redacted-ws-url>'];
  };
  codexHome: '<redacted-codex-home>';
  method: typeof CODEX_RATE_LIMITS_READ_METHOD;
  requestSent: true;
  rawFramesPersisted: false;
  parsed: ProviderQuotaResult;
  frameSummary: {
    stdoutBytes: number;
    stderrBytes: number;
    responseFramesSeen: number;
  };
};

export type CodexProxyChildProcess = {
  stdin: Pick<Writable, 'write' | 'end'>;
  stdout: Pick<Readable, 'on'>;
  stderr: Pick<Readable, 'on'>;
  on(
    event: 'close',
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void
  ): void;
  on(event: 'error', listener: (error: Error) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
};

export type CodexProxyProcessStarter = {
  start(input: { codexHome: string; socketPath: string }): CodexProxyChildProcess;
};

export type CodexProbeWebSocketMessageEvent = { data: unknown };

export type CodexProbeWebSocket = {
  send(data: string): void;
  close(): void;
  addEventListener(event: 'open', listener: () => void): void;
  addEventListener(
    event: 'message',
    listener: (event: CodexProbeWebSocketMessageEvent) => void
  ): void;
  addEventListener(event: 'error' | 'close', listener: (event: unknown) => void): void;
};

export type CodexProbeWebSocketFactory = {
  connect(url: string): CodexProbeWebSocket;
};

export class NodeCodexProxyProcessStarter implements CodexProxyProcessStarter {
  start(input: { codexHome: string; socketPath: string }): CodexProxyChildProcess {
    return spawn('codex', ['app-server', 'proxy', '--sock', input.socketPath], {
      env: { ...process.env, CODEX_HOME: input.codexHome },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }
}

class NodeBuiltinWebSocket implements CodexProbeWebSocket {
  private readonly openListeners: (() => void)[] = [];
  private readonly messageListeners: ((event: CodexProbeWebSocketMessageEvent) => void)[] = [];
  private readonly closeListeners: ((event: unknown) => void)[] = [];
  private readonly errorListeners: ((event: unknown) => void)[] = [];
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);

  constructor(url: string) {
    const parsed = new URL(url.replace(/^ws:/u, 'http:'));
    const key = randomBytes(16).toString('base64');
    const req = http.request({
      hostname: parsed.hostname,
      port: Number(parsed.port) || 80,
      path: parsed.pathname || '/',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });
    req.on('upgrade', (_res, rawSocket, head) => {
      this.socket = rawSocket;
      if (head.length > 0) this.onData(head);
      for (const fn of this.openListeners) fn();
      rawSocket.on('data', (chunk: Buffer) => this.onData(chunk));
      rawSocket.on('error', (err: Error) => {
        for (const fn of this.errorListeners) fn(err);
      });
      rawSocket.on('close', () => {
        for (const fn of this.closeListeners) fn({});
      });
    });
    req.on('response', (res) => {
      for (const fn of this.errorListeners)
        fn(new Error(`WebSocket upgrade rejected: ${String(res.statusCode)}`));
      res.resume();
    });
    req.on('error', (err) => {
      for (const fn of this.errorListeners) fn(err);
    });
    req.end();
  }

  send(data: string): void {
    if (!this.socket) return;
    const payload = Buffer.from(data, 'utf8');
    const maskKey = randomBytes(4);
    const long = payload.length > 125;
    const header = Buffer.alloc(long ? 8 : 6);
    header[0] = 0x81; // FIN + text frame opcode
    header[1] = long ? 0x80 | 126 : 0x80 | payload.length;
    if (long) header.writeUInt16BE(payload.length, 2);
    maskKey.copy(header, long ? 4 : 2);
    const masked = Buffer.allocUnsafe(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ maskKey[i % 4];
    this.socket.write(Buffer.concat([header, masked]));
  }

  close(): void {
    this.socket?.destroy();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(event: string, listener: (e?: any) => void): void {
    if (event === 'open') this.openListeners.push(listener as () => void);
    else if (event === 'message')
      this.messageListeners.push(listener as (event: CodexProbeWebSocketMessageEvent) => void);
    else if (event === 'error') this.errorListeners.push(listener as (e: unknown) => void);
    else if (event === 'close') this.closeListeners.push(listener as (e: unknown) => void);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 2) break;
      const opcode = this.buffer[0] & 0x0f;
      let payloadLen = this.buffer[1] & 0x7f;
      let offset = 2;
      if (payloadLen === 126) {
        if (this.buffer.length < 4) break;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        break; // >65535 bytes — not expected in rate-limits responses
      }
      if (this.buffer.length < offset + payloadLen) break;
      const payload = this.buffer.subarray(offset, offset + payloadLen);
      this.buffer = this.buffer.subarray(offset + payloadLen);
      if (opcode === 0x8) {
        this.socket?.destroy();
        for (const fn of this.closeListeners) fn({});
        return;
      }
      if (opcode === 0x1 || opcode === 0x0) {
        const msg: CodexProbeWebSocketMessageEvent = { data: payload.toString('utf8') };
        for (const fn of this.messageListeners) fn(msg);
      }
    }
  }
}

export class NodeCodexProbeWebSocketFactory implements CodexProbeWebSocketFactory {
  connect(url: string): CodexProbeWebSocket {
    const WebSocketConstructor = (
      globalThis as { WebSocket?: new (url: string) => CodexProbeWebSocket }
    ).WebSocket;
    if (WebSocketConstructor) return new WebSocketConstructor(url);
    return new NodeBuiltinWebSocket(url);
  }
}

export async function runCodexLiveRateLimitsProbe(
  input: CodexLiveRateLimitsProbeInput,
  starter: CodexProxyProcessStarter = new NodeCodexProxyProcessStarter(),
  webSocketFactory: CodexProbeWebSocketFactory = new NodeCodexProbeWebSocketFactory()
): Promise<CodexLiveRateLimitsProbeEvidence> {
  if (process.env.AIQM_ENABLE_CODEX_LIVE_PROBE !== '1') {
    throw new Error('Codex live probe is disabled; set AIQM_ENABLE_CODEX_LIVE_PROBE=1 to opt in');
  }
  if (!input.codexHome.trim()) throw new Error('--codex-home is required for Codex live probe');
  if (input.socketPath && input.wsUrl) throw new Error('Use either --socket or --ws-url, not both');
  if (!input.socketPath && !input.wsUrl) {
    throw new Error('Either --socket or --ws-url is required for Codex live probe');
  }
  if (input.wsUrl && !isSafeLoopbackWebSocketUrl(input.wsUrl)) {
    throw new Error('--ws-url must be a loopback ws:// URL');
  }

  const response = input.wsUrl
    ? await runWebSocketProbe(input.wsUrl, input.timeoutMs ?? 5_000, webSocketFactory)
    : await runSocketProxyProbe(
        input.socketPath ?? '',
        input.codexHome,
        input.timeoutMs ?? 5_000,
        starter
      );

  const parsed = parseCodexRateLimitsResponse(response.payload, {
    accountEmail: input.accountEmail,
    fetchedAt: input.fetchedAt
  });

  const evidence: CodexLiveRateLimitsProbeEvidence = {
    schemaVersion: '1',
    probe: 'codex-app-server-rate-limits-read',
    transport: input.wsUrl ? 'websocket' : 'socket-proxy',
    command: input.wsUrl
      ? {
          executable: 'websocket',
          args: ['<redacted-ws-url>']
        }
      : {
          executable: 'codex',
          args: ['app-server', 'proxy', '--sock', '<redacted-socket-path>']
        },
    codexHome: '<redacted-codex-home>',
    method: CODEX_RATE_LIMITS_READ_METHOD,
    requestSent: true,
    rawFramesPersisted: false,
    parsed,
    frameSummary: {
      stdoutBytes: response.stdoutBytes,
      stderrBytes: response.stderrBytes,
      responseFramesSeen: response.responseFramesSeen
    }
  };

  const safeEvidence = redactSecrets(evidence) as CodexLiveRateLimitsProbeEvidence;
  if (input.outputPath) {
    await writeFile(input.outputPath, `${JSON.stringify(safeEvidence, null, 2)}\n`, 'utf8');
  }
  return safeEvidence;
}

type CodexProbeResponse = {
  payload: unknown;
  stdoutBytes: number;
  stderrBytes: number;
  responseFramesSeen: number;
};

function runSocketProxyProbe(
  socketPath: string,
  codexHome: string,
  timeoutMs: number,
  starter: CodexProxyProcessStarter
): Promise<CodexProbeResponse> {
  const initializeRequest = createInitializeRequest();
  const initializedNotification = createInitializedNotification();
  const rateLimitsRequest = createCodexRateLimitsRequest(CODEX_RATE_LIMITS_READ_METHOD);
  const child = starter.start({ codexHome, socketPath });

  return new Promise<CodexProbeResponse>((resolve, reject) => {
    let stdout = '';
    let stderrBytes = 0;
    let consumedLength = 0;
    let responseFramesSeen = 0;
    let initialized = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new ProviderUnavailableError('Codex live probe timed out'));
    }, timeoutMs);

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.length > 128_000) {
        settle(() => {
          child.kill('SIGTERM');
          reject(new ProviderUnavailableError('Codex live probe output exceeded safe limit'));
        });
        return;
      }

      const parsedFrames = readJsonLines(stdout, consumedLength);
      consumedLength = parsedFrames.consumedLength;
      for (const frame of parsedFrames.values) {
        responseFramesSeen += 1;
        const responseId = readResponseId(frame);
        if (responseId === initializeRequest.id) {
          initialized = true;
          writeSocketFrame(child, initializedNotification);
          writeSocketFrame(child, rateLimitsRequest);
          child.stdin.end();
          continue;
        }
        if (responseId === rateLimitsRequest.id) {
          if (!initialized) {
            settle(() => {
              child.kill('SIGTERM');
              reject(
                new ProviderUnavailableError('Codex live probe response arrived before initialize')
              );
            });
            return;
          }
          settle(() => {
            child.kill('SIGTERM');
            resolve({
              payload: unwrapJsonRpcResult(frame),
              stdoutBytes: stdout.length,
              stderrBytes,
              responseFramesSeen
            });
          });
          return;
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBytes += chunk.toString().length;
    });
    child.on('error', (error) => {
      settle(() => reject(new ProviderUnavailableError(redactedErrorMessage(error))));
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settle(() =>
        reject(
          new ProviderUnavailableError(
            `Codex live probe proxy closed before response: ${String(exitCode)}`
          )
        )
      );
    });

    writeSocketFrame(child, initializeRequest);
  });
}

export function readCodexRateLimitsFromWebSocket(
  wsUrl: string,
  timeoutMs = 5_000,
  webSocketFactory: CodexProbeWebSocketFactory = new NodeCodexProbeWebSocketFactory()
): Promise<unknown> {
  return runWebSocketProbe(wsUrl, timeoutMs, webSocketFactory).then((response) => response.payload);
}

function runWebSocketProbe(
  wsUrl: string,
  timeoutMs: number,
  webSocketFactory: CodexProbeWebSocketFactory
): Promise<CodexProbeResponse> {
  const initializeRequest = createInitializeRequest();
  const initializedNotification = createInitializedNotification();
  const rateLimitsRequest = createCodexRateLimitsRequest(CODEX_RATE_LIMITS_READ_METHOD);
  const ws = webSocketFactory.connect(wsUrl);

  return new Promise<CodexProbeResponse>((resolve, reject) => {
    let responseBytes = 0;
    let responseFramesSeen = 0;
    let initialized = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new ProviderUnavailableError('Codex live probe timed out'));
    }, timeoutMs);

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    ws.addEventListener('open', () => {
      writeWebSocketFrame(ws, initializeRequest);
    });
    ws.addEventListener('message', (event) => {
      const frame = parseWebSocketMessage(event.data);
      responseBytes += frame.byteLength;
      if (responseBytes > 128_000) {
        settle(() => {
          ws.close();
          reject(new ProviderUnavailableError('Codex live probe output exceeded safe limit'));
        });
        return;
      }
      if (!frame.parsedOk) return;
      responseFramesSeen += 1;
      const responseId = readResponseId(frame.parsed);
      if (responseId === initializeRequest.id) {
        initialized = true;
        writeWebSocketFrame(ws, initializedNotification);
        writeWebSocketFrame(ws, rateLimitsRequest);
        return;
      }
      if (responseId === rateLimitsRequest.id) {
        if (!initialized) {
          settle(() => {
            ws.close();
            reject(
              new ProviderUnavailableError('Codex live probe response arrived before initialize')
            );
          });
          return;
        }
        settle(() => {
          ws.close();
          resolve({
            payload: unwrapJsonRpcResult(frame.parsed),
            stdoutBytes: responseBytes,
            stderrBytes: 0,
            responseFramesSeen
          });
        });
      }
    });
    ws.addEventListener('error', () => {
      settle(() => reject(new ProviderUnavailableError('Codex live probe WebSocket failed')));
    });
    ws.addEventListener('close', () => {
      if (settled) return;
      settle(() => reject(new ProviderUnavailableError('Codex live probe WebSocket closed')));
    });
  });
}

type AllowedCodexLiveProbeFrame =
  | ReturnType<typeof createInitializeRequest>
  | ReturnType<typeof createInitializedNotification>
  | ReturnType<typeof createCodexRateLimitsRequest>;

function createInitializeRequest() {
  return {
    id: 'aiqm-initialize',
    method: 'initialize',
    params: {
      clientInfo: {
        name: 'aiqm',
        title: 'AIQM Codex rate limit probe',
        version: '1.0.0'
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: []
      }
    }
  } as const;
}

function createInitializedNotification() {
  return { method: 'initialized' } as const;
}

function writeSocketFrame(child: CodexProxyChildProcess, frame: AllowedCodexLiveProbeFrame): void {
  assertAllowedFrame(frame);
  child.stdin.write(`${JSON.stringify(frame)}\n`);
}

function writeWebSocketFrame(ws: CodexProbeWebSocket, frame: AllowedCodexLiveProbeFrame): void {
  assertAllowedFrame(frame);
  ws.send(JSON.stringify(frame));
}

function assertAllowedFrame(frame: Record<string, unknown>): void {
  if (
    frame.method !== 'initialize' &&
    frame.method !== 'initialized' &&
    frame.method !== CODEX_RATE_LIMITS_READ_METHOD
  ) {
    throw new Error('Unsupported Codex live probe frame');
  }
}

function parseWebSocketMessage(data: unknown): {
  byteLength: number;
  parsed: unknown;
  parsedOk: boolean;
} {
  const text = typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf8');
  try {
    return {
      byteLength: Buffer.byteLength(text),
      parsed: JSON.parse(text) as unknown,
      parsedOk: true
    };
  } catch {
    return { byteLength: Buffer.byteLength(text), parsed: null, parsedOk: false };
  }
}

function isSafeLoopbackWebSocketUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'ws:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

function readJsonLines(
  text: string,
  consumedLength: number
): { values: unknown[]; consumedLength: number } {
  const values: unknown[] = [];
  let nextConsumedLength = consumedLength;
  while (nextConsumedLength < text.length) {
    const newlineIndex = text.indexOf('\n', nextConsumedLength);
    if (newlineIndex === -1) break;

    const line = text.slice(nextConsumedLength, newlineIndex);
    nextConsumedLength = newlineIndex + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      values.push(JSON.parse(trimmed) as unknown);
    } catch {
      // Ignore non-JSON log lines while never persisting them.
    }
  }

  return { values, consumedLength: nextConsumedLength };
}

function readResponseId(value: unknown): string | number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function unwrapJsonRpcResult(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  if ('result' in object) return object.result;
  if ('error' in object) return object;
  return value;
}

function redactedErrorMessage(error: Error): string {
  const redacted = redactSecrets(error.message);
  return typeof redacted === 'string' ? redacted : 'Codex live probe proxy failed';
}
