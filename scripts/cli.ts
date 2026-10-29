import { migrate } from '../db/migrate';
import { seed } from '../db/seed';
const cmds: Record<string, () => Promise<void>> = { migrate, seed };
const fn = cmds[process.argv[2]];
if (!fn) { console.error('usage: cli.ts migrate|seed'); process.exit(1); }
fn().then(() => { console.log('done'); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
