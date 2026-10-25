import { migrate } from './db/migrate.js';

async function start(): Promise<void> {
  await migrate();
  await import('./index.js');
}

start().catch((err: Error) => {
  process.stderr.write(`Fatal telemetry startup/migration error: ${err.message}\n`);
  process.exit(1);
});
