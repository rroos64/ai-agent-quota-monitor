// Provenance: docs/test-traceability.md — Setup/TUI area
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServices } from '../../src/app/index.js';

async function tempServices() {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-setup-flow-'));
  return createAppServices({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') }, {});
}

// Traceability: BR: provider auth session setup; AC: setup validates completed identity and stores token references without leaking secrets; TS: AUTH-001 session-style provider setup architecture.
describe('SetupFlowService fake auth sessions', () => {
  it('rejects completed fake auth sessions whose email does not match setup input', async () => {
    const services = await tempServices();

    await expect(
      services.setupFlowService.addFakeAccount({
        provider: 'fake',
        email: 'dev@example.com',
        scenario: 'success',
        displayOrder: 0,
        authActualEmail: 'other@example.com'
      })
    ).rejects.toThrow(
      'Authenticated account email does not match expected email: other@example.com'
    );

    await expect(services.configStore.getAccounts()).resolves.toEqual([]);
  });

  it('adds fake accounts through session-style auth without leaking token payloads', async () => {
    const services = await tempServices();

    const result = await services.setupFlowService.addFakeAccount({
      provider: 'fake',
      email: 'dev@example.com',
      scenario: 'success',
      displayOrder: 0
    });

    expect(result).toMatchObject({
      added: true,
      account: { provider: 'fake', email: 'dev@example.com' },
      tokenRef: { provider: 'fake', accountId: 'fake:dev@example.com' }
    });
    expect(JSON.stringify(result)).not.toContain('tokenPayload');
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });
});
