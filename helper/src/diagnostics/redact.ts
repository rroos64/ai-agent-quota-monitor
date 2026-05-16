const sensitiveKeyPattern =
  /^(token|access_token|accesstoken|refresh_token|refreshtoken|authorization|cookie|session|sessionid|secret|clientsecret|api_key|apikey|password|passwordhash|auth|authheader|authtoken|bearertoken|credential|credentialid|usercode|devicecode|verificationurl|verificationuri|url)$/iu;
export const REDACTED_VALUE = '[REDACTED]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPattern.test(key);
}

function redactSecretText(value: string): string {
  let redacted = value.replace(/SECRET_SENTINEL_DO_NOT_LEAK/gu, REDACTED_VALUE);
  redacted = redacted.replace(
    /\b(authorization)(\s*[:=]\s*)(Bearer\s+)?([^\s"'`,;}]+)/giu,
    (_match, key: string, separator: string, bearer: string | undefined) =>
      `${key}${separator}${bearer ?? ''}${REDACTED_VALUE}`
  );
  redacted = redacted.replace(/\b(Bearer)(\s+)([^\s"'`,;}]+)/giu, `$1$2${REDACTED_VALUE}`);
  redacted = redacted.replace(
    /\b(access_token|refresh_token|api_key|apikey|cookie|session|sessionid|user_code|usercode|device_code|devicecode|verification_url|verificationurl|verification_uri|verificationuri)(\s*[:=]\s*)([^\s"'`,;}]+)/giu,
    `$1$2${REDACTED_VALUE}`
  );
  redacted = redacted.replace(/https?:\/\/[^\s"'`<>]+/giu, REDACTED_VALUE);
  return redacted;
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactSecretText(value);

  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactSecrets(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactSecrets(nestedValue);
  }

  return redacted;
}
