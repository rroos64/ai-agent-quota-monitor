export const PROVIDER_IDS = ['fake', 'codex', 'antigravity', 'claude-code'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.includes(value as ProviderId);
}

export function providerDisplayName(provider: ProviderId): string {
  switch (provider) {
    case 'fake':
      return 'Fake';
    case 'codex':
      return 'Codex';
    case 'antigravity':
      return 'Antigravity';
    case 'claude-code':
      return 'Claude Code';
  }
}
