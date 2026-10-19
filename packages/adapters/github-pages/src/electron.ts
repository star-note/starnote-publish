/** Desktop impl: same as the browser (renderer fetch to api.github.com with a server-issued token). */
import { createGithubPagesClientAdapter } from './web';

import type { Adapter } from '@starnote/publish-core';
import type { GithubPagesAdapterOptions } from './shared/adapter';
import type { githubPagesSchema } from './shared/schema';

export function createGithubPagesElectronAdapter(
  overrides: Partial<GithubPagesAdapterOptions> = {}
): Adapter<typeof githubPagesSchema> {
  return createGithubPagesClientAdapter('electron', overrides);
}

export const githubPagesElectronAdapter = createGithubPagesElectronAdapter();
