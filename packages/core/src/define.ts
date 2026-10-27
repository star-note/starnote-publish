import { parsePostUrl } from './post-url';
import { runtimeList } from './runtime';

import type { z } from 'zod';
import type { Adapter } from './types';

/** An adapter as authored: give `runtimes` (preferred) or the legacy `runtime` list, or both. */
export type AdapterDefinition<S extends z.ZodType = z.ZodType> = Omit<Adapter<S>, 'runtime'> & {
  runtime?: Adapter<S>['runtime'];
};

/**
 * Fills the legacy `runtime` list from `runtimes` (or `runtimes` stays unset when only `runtime` is
 * given), so new adapters declare their runtimes once and old hosts that read `adapter.runtime` keep working.
 * Adds `parsePostUrl` from core's rules for the adapter's key (SPEC-r12 §1.1) unless the adapter has its own.
 */
export function defineAdapter<S extends z.ZodType>(def: AdapterDefinition<S>): Adapter<S> {
  const runtime = def.runtimes?.length ? runtimeList(def) : (def.runtime ?? []);
  return {
    ...def,
    runtime,
    parsePostUrl: def.parsePostUrl ?? ((url: string) => parsePostUrl(def.key, url)),
  };
}
