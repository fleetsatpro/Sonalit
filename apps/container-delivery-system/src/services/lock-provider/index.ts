import type { LockProvider, LockProviderConfig } from './types.js';
import { SecuriSatProvider } from './SecuriSatProvider.js';

export type { LockProvider, LockProviderConfig, LockDeviceInfo, LockGPSData, LockEvent, LockHealthReport } from './types.js';

const providers: Map<string, () => LockProvider> = new Map([
  ['securisat', () => new SecuriSatProvider()],
]);

export function createLockProvider(name: string): LockProvider {
  const factory = providers.get(name.toLowerCase());
  if (!factory) throw new Error(`Unknown lock provider: ${name}`);
  return factory();
}

export function registerLockProvider(name: string, factory: () => LockProvider) {
  providers.set(name.toLowerCase(), factory);
}

export function getAvailableProviders(): string[] {
  return Array.from(providers.keys());
}

let activeProvider: LockProvider | null = null;

export async function initializeLockProvider(name: string, config: LockProviderConfig): Promise<LockProvider> {
  const provider = createLockProvider(name);
  await provider.authenticate(config);
  activeProvider = provider;
  return provider;
}

export function getActiveLockProvider(): LockProvider {
  if (!activeProvider) throw new Error('No lock provider initialized');
  return activeProvider;
}
