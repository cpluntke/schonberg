// Vitest global setup for the realism harness: clear the before/after parts at the start, merge
// them into docs/qa/realism-current.md at the end (see report-current.ts).
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeCurrentReport } from './report-current';

export default function setup(): () => void {
  rmSync(resolve(__dirname, 'out/parts'), { recursive: true, force: true });
  return () => {
    if (writeCurrentReport()) console.log('realism: wrote docs/qa/realism-current.md and qa/realism/out/report-current.json');
  };
}
