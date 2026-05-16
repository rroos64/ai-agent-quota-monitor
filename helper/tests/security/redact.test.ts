// Provenance: docs/test-traceability.md — Security area
import { describe, expect, it } from 'vitest';
import { REDACTED_VALUE, isSensitiveKey, redactSecrets } from '../../src/diagnostics/index.js';

const secretSentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';

// Traceability: BR: diagnostics must be secret-safe; AC: recursive redaction for sensitive keys preserves safe fields; TS: TSD diagnostics/logging secret handling.
describe('redactSecrets', () => {
  it('redacts sensitive keys case-insensitively while preserving safe fields', () => {
    const input = {
      email: 'dev@example.com',
      Token: secretSentinel,
      access_token: secretSentinel,
      refresh_token: secretSentinel,
      Authorization: secretSentinel,
      cookie: secretSentinel,
      session: secretSentinel,
      Secret: secretSentinel,
      api_key: secretSentinel,
      apikey: secretSentinel,
      password: secretSentinel,
      auth: secretSentinel,
      credential: secretSentinel,
      status: 'fresh'
    };

    const output = redactSecrets(input) as typeof input;

    expect(output.email).toBe('dev@example.com');
    expect(output.status).toBe('fresh');
    expect(JSON.stringify(output)).not.toContain(secretSentinel);
    expect(output.Token).toBe(REDACTED_VALUE);
    expect(output.Authorization).toBe(REDACTED_VALUE);
  });

  it('redacts nested objects and arrays', () => {
    const output = redactSecrets({
      safe: [{ value: 1 }, { nested: { cookie: secretSentinel, safe: 'ok' } }],
      providers: [{ credentials: { token: secretSentinel } }]
    }) as {
      safe: [{ value: number }, { nested: { cookie: string; safe: string } }];
      providers: [{ credentials: { token: string } }];
    };

    expect(output.safe[0]).toEqual({ value: 1 });
    expect(output.safe[1].nested.safe).toBe('ok');
    expect(JSON.stringify(output)).not.toContain(secretSentinel);
    expect(output.safe[1].nested.cookie).toBe(REDACTED_VALUE);
    expect(output.providers[0].credentials.token).toBe(REDACTED_VALUE);
  });

  it('redacts common camelCase and compound secret keys', () => {
    const input = {
      accessToken: secretSentinel,
      refreshToken: secretSentinel,
      apiKey: secretSentinel,
      sessionId: secretSentinel,
      authHeader: secretSentinel,
      authToken: secretSentinel,
      bearerToken: secretSentinel,
      clientSecret: secretSentinel,
      credentialId: secretSentinel,
      passwordHash: secretSentinel,
      userCode: secretSentinel,
      deviceCode: secretSentinel,
      verificationUrl: secretSentinel,
      email: 'dev@example.com',
      status: 'fresh',
      authStatus: 'ok',
      tokenCount: 123
    };

    const output = redactSecrets(input) as typeof input;

    expect(JSON.stringify(output)).not.toContain(secretSentinel);
    expect(output.accessToken).toBe(REDACTED_VALUE);
    expect(output.refreshToken).toBe(REDACTED_VALUE);
    expect(output.apiKey).toBe(REDACTED_VALUE);
    expect(output.sessionId).toBe(REDACTED_VALUE);
    expect(output.authHeader).toBe(REDACTED_VALUE);
    expect(output.authToken).toBe(REDACTED_VALUE);
    expect(output.bearerToken).toBe(REDACTED_VALUE);
    expect(output.clientSecret).toBe(REDACTED_VALUE);
    expect(output.credentialId).toBe(REDACTED_VALUE);
    expect(output.passwordHash).toBe(REDACTED_VALUE);
    expect(output.userCode).toBe(REDACTED_VALUE);
    expect(output.deviceCode).toBe(REDACTED_VALUE);
    expect(output.verificationUrl).toBe(REDACTED_VALUE);
    expect(output.email).toBe('dev@example.com');
    expect(output.status).toBe('fresh');
    expect(output.authStatus).toBe('ok');
    expect(output.tokenCount).toBe(123);
  });

  it('redacts auth headers and assignment-style secrets in plain strings without over-redacting benign token text', () => {
    const input = [
      'Authorization: Bearer sk-auth-header-value',
      'authorization=Bearer sk-lower-header-value',
      'Bearer sk-bare-bearer-value',
      'cookie=sessionid=abc123',
      'session=abc123',
      'access_token=acc_123',
      'refresh_token: ref_123',
      'api_key=key_123',
      'user_code=ABCD-EFGH',
      'verification_url=https://example.com/device',
      'Open https://example.com/activate to continue',
      'token count is 5'
    ].join('\n');

    const output = redactSecrets(input) as string;

    expect(output).not.toContain('sk-auth-header-value');
    expect(output).not.toContain('sk-lower-header-value');
    expect(output).not.toContain('sk-bare-bearer-value');
    expect(output).not.toContain('abc123');
    expect(output).not.toContain('acc_123');
    expect(output).not.toContain('ref_123');
    expect(output).not.toContain('key_123');
    expect(output).not.toContain('ABCD-EFGH');
    expect(output).not.toContain('https://example.com');
    expect(output).toContain(`Authorization: Bearer ${REDACTED_VALUE}`);
    expect(output).toContain(`authorization=Bearer ${REDACTED_VALUE}`);
    expect(output).toContain(`Bearer ${REDACTED_VALUE}`);
    expect(output).toContain('token count is 5');
  });

  it('recognizes sensitive keys exactly and does not over-redact safe names', () => {
    expect(isSensitiveKey('token')).toBe(true);
    expect(isSensitiveKey('TOKEN')).toBe(true);
    expect(isSensitiveKey('api_key')).toBe(true);
    expect(isSensitiveKey('accessToken')).toBe(true);
    expect(isSensitiveKey('refreshToken')).toBe(true);
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('sessionId')).toBe(true);
    expect(isSensitiveKey('authHeader')).toBe(true);
    expect(isSensitiveKey('authToken')).toBe(true);
    expect(isSensitiveKey('bearerToken')).toBe(true);
    expect(isSensitiveKey('clientSecret')).toBe(true);
    expect(isSensitiveKey('credentialId')).toBe(true);
    expect(isSensitiveKey('passwordHash')).toBe(true);
    expect(isSensitiveKey('userCode')).toBe(true);
    expect(isSensitiveKey('deviceCode')).toBe(true);
    expect(isSensitiveKey('verificationUrl')).toBe(true);
    expect(isSensitiveKey('auth')).toBe(true);
    expect(isSensitiveKey('authStatus')).toBe(false);
    expect(isSensitiveKey('tokenCount')).toBe(false);
  });
});
