/* global URL, console */
// Writes dist/platforms.json from the built registry so non-TS consumers (the FastAPI backend) read the
// same platform keys, names and capabilities as the web app. Run after tsup.
import { writeFileSync } from 'node:fs';

const { PLATFORMS, COMPLIANCE_LEXICON, COMPLIANCE_MESSAGES, SDK_LANGS } = await import(
  new URL('../dist/index.js', import.meta.url)
);
// ``labels`` per platform (SPEC-r14 B5) ride on each entry; ``compliance.messages``: the message templates of every
// language (``{name}`` placeholders), so the Python port answers in the user's language too.
// ``compliance``: the word lists / regex sources of ``checkCompliance`` so the backend's minimal Python port
// (``app/services/compliance_rules.py``) judges with the same data before a server-side publish (SPEC-r8 §12.9).
writeFileSync(
  new URL('../dist/platforms.json', import.meta.url),
  `${JSON.stringify(
    {
      version: 2,
      langs: SDK_LANGS,
      platforms: PLATFORMS,
      compliance: { ...COMPLIANCE_LEXICON, messages: COMPLIANCE_MESSAGES },
    },
    null,
    2
  )}\n`
);
console.log(`platforms.json: ${PLATFORMS.length} platforms`);
