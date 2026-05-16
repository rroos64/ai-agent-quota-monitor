import type { ProviderId } from '../../domain/index.js';
import { DuplicateProviderError, UnknownProviderError } from './errors.js';
import type { ProviderAdapter } from './types.js';

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.providerId)) {
      throw new DuplicateProviderError(adapter.providerId);
    }
    this.adapters.set(adapter.providerId, adapter);
  }

  get(providerId: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new UnknownProviderError(providerId);
    return adapter;
  }

  has(providerId: ProviderId): boolean {
    return this.adapters.has(providerId);
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
