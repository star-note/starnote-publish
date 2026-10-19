/* global URL, console */
// Writes dist/platforms.json from the built registry so non-TS consumers (the FastAPI backend) read the
// same platform keys, names and capabilities as the web app. Run after tsup.
import { writeFileSync } from 'node:fs';

const { PLATFORMS, COMPLIANCE_LEXICON } = await import(new URL('../dist/index.js', import.meta.url));
// ``compliance``: the word lists / regex sources of ``checkCompliance`` so the backend's minimal Python port
// (``app/services/compliance_rules.py``) judges with the same data before a server-side publish (SPEC-r8 §12.9).
writeFileSync(
  new URL('../dist/platforms.json', import.meta.url),
  `${JSON.stringify({ version: 2, platforms: PLATFORMS, compliance: COMPLIANCE_LEXICON }, null, 2)}\n`
);
console.log(`platforms.json: ${PLATFORMS.length} platforms`);
