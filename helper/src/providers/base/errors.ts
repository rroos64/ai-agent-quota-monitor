import {
  AiqmError,
  AuthRequiredError,
  ConfigError,
  OfflineError,
  ProviderError
} from '../../domain/index.js';

export class ProviderRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DuplicateProviderError extends ProviderRegistryError {
  constructor(providerId: string) {
    super(`Provider already registered: ${providerId}`);
  }
}

export class UnknownProviderError extends ProviderRegistryError {
  constructor(providerId: string) {
    super(`Unknown provider: ${providerId}`);
  }
}

export class ProviderUnavailableError extends OfflineError {
  constructor(message = 'Provider is unavailable') {
    super(message);
  }
}

export class ProviderShapeChangedError extends ProviderError {
  constructor(message = 'Provider response shape changed') {
    super(message);
  }
}

export class ProviderSpikeRequiredError extends ProviderError {
  constructor(message = 'Provider spike is required before implementation') {
    super(message);
  }
}

export class ProviderNotImplementedError extends ProviderError {
  constructor(message = 'Provider is not implemented') {
    super(message);
  }
}

export { AiqmError, AuthRequiredError, ConfigError, OfflineError, ProviderError };
