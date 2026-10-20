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
 */
export function defineAdapter<S extends z.ZodType>(def: AdapterDefinition<S>): Adapter<S> {
  const runtime = def.runtimes?.length ? runtimeList(def) : (def.runtime ?? []);
  return { ...def, runtime };
}
