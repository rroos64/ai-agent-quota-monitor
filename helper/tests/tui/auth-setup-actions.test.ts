// Provenance: docs/test-traceability.md — Setup/TUI area
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServices } from '../../src/app/index.js';
import { submitFakeSetupAction } from '../../src/tui/index.js';

async function tempServices() {
  const root = await mkdtemp(join(tmpdir(), 'aiqm-tui-auth-actions-'));
  return createAppServices({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') }, {});
}

// Traceability: BR: interactive provider login setup; AC: fake TUI auth flow exposes waiting/instruction/success/failure states without token leakage; TS: TUI-AUTH-001 provider login flow shell.
describe('fake auth setup action flow', () => {
  it('emits waiting instructions and completes success without token leakage', async () => {
    const services = await tempServices();
    const progress: string[] = [];

    const result = await submitFakeSetupAction(
      { email: 'dev@example.com', scenario: 'success', pollAfterAdd: false },
      services,
      (event) => progress.push(`${event.phase}:${event.message}`)
    );

    expect(result.add.account).toMatchObject({ provider: 'fake', email: 'dev@example.com' });
    expect(result.events?.map((event) => event.phase)).toEqual([
      'provider',
      'email',
      'start_auth',
      'instructions',
      'waiting',
      'complete_auth',
      'validate',
      'test_quota',
      'save',
      'success'
    ]);
    expect(progress.join('\n')).toContain('instructions:Fake login');
    expect(progress.join('\n')).toContain('waiting:Waiting for fake provider login completion');
    expect(JSON.stringify(result)).not.toContain('tokenPayload');
    expect(JSON.stringify(result)).not.toContain('SECRET_SENTINEL_DO_NOT_LEAK');
  });

  it('surfaces expired and failed auth states before saving', async () => {
    const expiredServices = await tempServices();
    const expiredEvents: string[] = [];

    await expect(
      submitFakeSetupAction(
        {
          email: 'expired@example.com',
          scenario: 'success',
          pollAfterAdd: false,
          authOutcome: 'expired'
        },
        expiredServices,
        (event) => expiredEvents.push(event.phase)
      )
    ).rejects.toThrow('Fake auth session expired');
    expect(expiredEvents).toContain('expired');
    await expect(expiredServices.configStore.getAccounts()).resolves.toEqual([]);

    const failedServices = await tempServices();
    const failedEvents: string[] = [];
    await expect(
      submitFakeSetupAction(
        {
          email: 'failed@example.com',
          scenario: 'success',
          pollAfterAdd: false,
          authOutcome: 'failure'
        },
        failedServices,
        (event) => failedEvents.push(event.phase)
      )
    ).rejects.toThrow('Fake auth session failed');
    expect(failedEvents).toContain('failed');
  });

  it('surfaces cancelled and email mismatch states before saving', async () => {
    const cancelledServices = await tempServices();
    const cancelledEvents: string[] = [];
    await expect(
      submitFakeSetupAction(
        {
          email: 'cancelled@example.com',
          scenario: 'success',
          pollAfterAdd: false,
          authOutcome: 'cancelled'
        },
        cancelledServices,
        (event) => cancelledEvents.push(event.phase)
      )
    ).rejects.toThrow('Fake auth session cancelled');
    expect(cancelledEvents).toContain('cancelled');

    const mismatchServices = await tempServices();
    const mismatchEvents: string[] = [];
    await expect(
      submitFakeSetupAction(
        {
          email: 'dev@example.com',
          scenario: 'success',
          pollAfterAdd: false,
          authActualEmail: 'other@example.com'
        },
        mismatchServices,
        (event) => mismatchEvents.push(event.phase)
      )
    ).rejects.toThrow(
      'Authenticated account email does not match expected email: other@example.com'
    );
    expect(mismatchEvents).toContain('email_mismatch');
    await expect(mismatchServices.configStore.getAccounts()).resolves.toEqual([]);
  });

  it('surfaces quota unreadable fake scenario before saving', async () => {
    const services = await tempServices();
    const events: string[] = [];

    await expect(
      submitFakeSetupAction(
        { email: 'quota@example.com', scenario: 'auth_required', pollAfterAdd: false },
        services,
        (event) => events.push(event.phase)
      )
    ).rejects.toThrow('Quota unreadable during setup: Fake provider requires authentication');

    expect(events).toContain('quota_unreadable');
    await expect(services.configStore.getAccounts()).resolves.toEqual([]);
  });
});
