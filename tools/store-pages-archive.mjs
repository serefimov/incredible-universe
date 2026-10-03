// SPDX-License-Identifier: GPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeArchive } from './pages-archive.mjs';

// Non-forced push is the compare-and-swap. A rejected push rereads the winner
// and merges our immutable payload again, retaining all concurrent builds.
export async function storeArchive(repo, payload, { attempts = 8, remote = 'origin', branch = 'pages-archive' } = {}) {
  const worktree = await mkdtemp(resolve(tmpdir(), 'universe-archive-'));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
  const tracking = `refs/remotes/${remote}/${branch}`;
  let added = false;
  try {
    git(repo, 'worktree', 'add', '--detach', worktree, 'HEAD'); added = true;
    git(worktree, 'config', 'user.name', 'github-actions[bot]');
    git(worktree, 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    for (let attempt = 0; attempt < attempts; attempt++) {
      const exists = git(repo, 'ls-remote', '--heads', remote, `refs/heads/${branch}`);
      if (exists) {
        git(repo, 'fetch', remote, `+refs/heads/${branch}:${tracking}`);
        git(worktree, 'checkout', '--detach', tracking);
        git(worktree, 'reset', '--hard', tracking);
      } else {
        git(worktree, 'checkout', '--orphan', `archive-initial-${attempt}`);
        git(worktree, 'rm', '-rf', '.');
      }
      git(worktree, 'clean', '-fd');
      await mergeArchive(payload, worktree);
      git(worktree, 'add', '.');
      if (git(worktree, 'diff', '--cached', '--name-only') === '') return;
      git(worktree, 'commit', '-m', '#22 сохранил сборки GitHub Pages');
      try { git(worktree, 'push', remote, `HEAD:refs/heads/${branch}`); return; }
      catch (error) {
        if (attempt === attempts - 1) throw error;
        // Retry only if another writer changed the remote. Permission/network
        // failures must not be reported as a successful archive update.
        const now = git(repo, 'ls-remote', '--heads', remote, `refs/heads/${branch}`).split(/\s/)[0];
        if (!now || now === exists.split(/\s/)[0]) throw error;
      }
    }
  } finally {
    if (added) git(repo, 'worktree', 'remove', '--force', worktree);
    await rm(worktree, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await storeArchive(process.cwd(), resolve('dist/payload'));
}
