/**
 * Writes every template (and a feature-rich sample) to .pptx files so they can
 * be opened in third-party presentation software for interoperability checks.
 *   npx tsx scripts/interop-export.ts <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATES, exportPptx } from '../packages/core/src';

const out = process.argv[2] ?? 'interop-out';
mkdirSync(out, { recursive: true });
for (const t of TEMPLATES) {
  const { bytes, warnings } = await exportPptx(t.build(), { assets: {} });
  writeFileSync(join(out, `${t.id}.pptx`), bytes);
  console.log(`${t.id}.pptx  ${bytes.length} bytes  ${warnings.length} warnings`);
}
