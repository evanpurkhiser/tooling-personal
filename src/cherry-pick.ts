import simpleGit from 'simple-git';

/**
 * Build a commit object equivalent to cherry-picking `sha` onto `base`, without
 * touching the working tree or any ref.
 *
 * Uses `git merge-tree --write-tree` (git >= 2.38) to produce the merged tree
 * in the object database, then `git commit-tree` to wrap it in a commit whose
 * parent is `base`. Author info and the full commit message are preserved from
 * the original commit; the committer is the current user (mirrors the way
 * `git rebase` / `git cherry-pick` work).
 *
 * Throws if the three-way merge has conflicts.
 */
export async function cherryPickOnto(sha: string, base: string): Promise<string> {
  const git = simpleGit();

  const parentSha = (await git.revparse([`${sha}^`])).trim();
  const baseSha = (await git.revparse([base])).trim();

  let treeOid: string;
  try {
    treeOid = (
      await git.raw([
        'merge-tree',
        '--write-tree',
        '--no-messages',
        `--merge-base=${parentSha}`,
        baseSha,
        sha,
      ])
    ).trim();
  } catch (error) {
    throw new Error(
      `Conflicts applying ${sha.slice(0, 8)} onto ${base}. Rebase locally and retry.\n${error}`,
      {cause: error},
    );
  }

  const info = await git.raw(['show', '-s', '--format=%an%n%ae%n%aI%n%B', sha]);
  const lines = info.split('\n');
  const authorName = lines[0];
  const authorEmail = lines[1];
  const authorDate = lines[2];
  const message = lines.slice(3).join('\n').replace(/\n+$/, '');

  const newCommit = await git
    .env({
      ...process.env,
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_AUTHOR_DATE: authorDate,
    })
    .raw(['commit-tree', treeOid, '-p', baseSha, '-m', message]);

  return newCommit.trim();
}
