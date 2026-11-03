import { config } from '../config.js';

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface BreakerStats {
  state: State;
  failures: number;
  lastFailureTime: number;
  openedAt: number;
}

const stats: BreakerStats = {
  state: 'CLOSED',
  failures: 0,
  lastFailureTime: 0,
  openedAt: 0,
};

const WINDOW_MS = 60_000;
const OPEN_DURATION_MS = 30_000;

function recordFailure(): void {
  const now = Date.now();
  if (now - stats.lastFailureTime > WINDOW_MS) {
    stats.failures = 0;
  }
  stats.failures += 1;
  stats.lastFailureTime = now;

  if (stats.failures >= config.CIRCUIT_BREAKER_THRESHOLD) {
    stats.state = 'OPEN';
    stats.openedAt = now;
  }
}

function recordSuccess(): void {
  stats.failures = 0;
  stats.state = 'CLOSED';
}

function checkState(): void {
  if (stats.state === 'OPEN') {
    if (Date.now() - stats.openedAt >= OPEN_DURATION_MS) {
      stats.state = 'HALF_OPEN';
    }
  }
}

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker is OPEN — upstream unavailable');
    this.name = 'CircuitOpenError';
  }
}

export async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  checkState();

  if (stats.state === 'OPEN') {
    throw new CircuitOpenError();
  }

  try {
    const result = await fn();
    if (stats.state === 'HALF_OPEN') {
      recordSuccess();
    }
    return result;
  } catch (err) {
    recordFailure();
    throw err;
  }
}

export function getBreakerState(): State {
  checkState();
  return stats.state;
}
