/**
 * One atomic commit of many files with the Git Data API (SPEC-r8 §4.4):
 * ref → commit → tree (skip unchanged) → blobs → tree → commit → update ref; a non-fast-forward
 * (the user pushed meanwhile) starts over from the ref, up to `maxAttempts` times.
 *
 * Python twin: `starnote-api/app/services/github_publish.py` `commit_files` (same calls, same skip / retry rules).
 */
import { github, GitHubApiError, refPath, repoPath } from './github';

import type { GitHubClientOptions } from './github';

export interface GitFile {
  path: string;
  /** Text is sent as UTF-8, bytes as base64; `null` deletes the file. */
  content: string | Uint8Array | null;
}

export interface CommitFilesOptions extends GitHubClientOptions {
  repo: string;
  branch: string;
  files: GitFile[];
  message: string;
  /** Default 3. */
  maxAttempts?: number;
  onStep?(text: string): void;
}

export interface CommitFilesResult {
  /** The new commit, or `null` when every file was already up to date. */
  commitSha: string | null;
  /** Branch head the commit is based on (or the unchanged head). */
  baseSha: string;
  written: string[];
  deleted: string[];
  unchanged: string[];
  attempts: number;
}

const encoder = new TextEncoder();

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? encoder.encode(content) : content;
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Git's blob id: `sha1("blob <len>\0" + bytes)` (WebCrypto; browser and Node 20+). */
export async function gitBlobSha(content: string | Uint8Array): Promise<string> {
  const bytes = toBytes(content);
  const head = encoder.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head, 0);
  all.set(bytes, head.length);
  return hex(await crypto.subtle.digest('SHA-1', all));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

interface Prepared {
  path: string;
  content: string | Uint8Array | null;
  sha: string | null;
}

export async function commitFiles(opts: CommitFilesOptions): Promise<CommitFilesResult> {
  const repo = repoPath(opts.repo);
  const ref = refPath(opts.branch);
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const prepared: Prepared[] = await Promise.all(
    opts.files.map(async (f) => ({
      path: f.path,
      content: f.content,
      sha: f.content === null ? null : await gitBlobSha(f.content),
    }))
  );
  /** local sha → sha GitHub returned, so a retry does not upload blobs again. */
  const uploaded = new Map<string, string>();

  for (let attempt = 1; ; attempt++) {
    opts.onStep?.('读取分支');
    const head = await github<{ object: { sha: string } }>(
      opts,
      'GET',
      `${repo}/git/ref/heads/${ref}`
    );
    const baseSha = head.data.object.sha;
    const commit = await github<{ tree: { sha: string } }>(
      opts,
      'GET',
      `${repo}/git/commits/${baseSha}`
    );
    const baseTree = commit.data.tree.sha;
    const tree = await github<{
      tree: Array<{ path: string; type: string; sha: string }>;
      truncated?: boolean;
    }>(opts, 'GET', `${repo}/git/trees/${baseTree}?recursive=1`);
    const existing = new Map(
      tree.data.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha])
    );
    // A truncated listing cannot prove a file is unchanged: write everything then.
    const known = (path: string) => (tree.data.truncated ? undefined : existing.get(path));

    const changed = prepared.filter((f) =>
      f.sha === null ? tree.data.truncated || existing.has(f.path) : known(f.path) !== f.sha
    );
    const unchanged = prepared.filter((f) => !changed.includes(f)).map((f) => f.path);
    if (!changed.length) {
      return { commitSha: null, baseSha, written: [], deleted: [], unchanged, attempts: attempt };
    }

    opts.onStep?.('上传文件');
    for (const f of changed) {
      if (f.content === null || f.sha === null || uploaded.has(f.sha)) continue;
      const body =
        typeof f.content === 'string'
          ? { content: f.content, encoding: 'utf-8' }
          : { content: toBase64(f.content), encoding: 'base64' };
      const blob = await github<{ sha: string }>(opts, 'POST', `${repo}/git/blobs`, body);
      uploaded.set(f.sha, blob.data.sha);
    }

    opts.onStep?.('生成提交');
    const newTree = await github<{ sha: string }>(opts, 'POST', `${repo}/git/trees`, {
      base_tree: baseTree,
      tree: changed.map((f) => ({
        path: f.path,
        mode: '100644',
        type: 'blob',
        sha: f.sha === null ? null : uploaded.get(f.sha),
      })),
    });
    const newCommit = await github<{ sha: string }>(opts, 'POST', `${repo}/git/commits`, {
      message: opts.message,
      tree: newTree.data.sha,
      parents: [baseSha],
    });
    try {
      await github(opts, 'PATCH', `${repo}/git/refs/heads/${ref}`, {
        sha: newCommit.data.sha,
        force: false,
      });
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 422 && attempt < maxAttempts) {
        opts.onStep?.('分支已更新，重新提交');
        continue;
      }
      throw e;
    }
    return {
      commitSha: newCommit.data.sha,
      baseSha,
      written: changed.filter((f) => f.content !== null).map((f) => f.path),
      deleted: changed.filter((f) => f.content === null).map((f) => f.path),
      unchanged,
      attempts: attempt,
    };
  }
}
