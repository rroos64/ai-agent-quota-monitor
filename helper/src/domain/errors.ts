import type { AccountStatus } from './status.js';

export class AiqmError extends Error {
  constructor(
    message: string,
    readonly status: AccountStatus = 'provider_error'
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthRequiredError extends AiqmError {
  constructor(message = 'Authentication is required') {
    super(message, 'auth_required');
  }
}

export class OfflineError extends AiqmError {
  constructor(message = 'Provider is offline or unreachable') {
    super(message, 'offline');
  }
}

export class ProviderError extends AiqmError {
  constructor(message = 'Provider returned an error') {
    super(message, 'provider_error');
  }
}

export class ConfigError extends AiqmError {
  constructor(message = 'Configuration is invalid') {
    super(message, 'config_error');
  }
}

export function statusFromError(error: unknown): AccountStatus {
  if (error instanceof AiqmError) return error.status;
  return 'provider_error';
}
