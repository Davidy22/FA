// CI entry point: check locale key structure and {{variable}} parity without
// modifying files. Use i18n-sync.mjs (without --check) to repair key drift.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const result = spawnSync(process.execPath, [path.resolve('scripts/i18n-sync.mjs'), '--check'], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
