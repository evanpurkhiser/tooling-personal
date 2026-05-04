import simpleGit, {type SimpleGit} from 'simple-git';

/**
 * Produce an actionable error for a failed `merge-tree` cherry-pick.
 *
 * The common failure mode for this workflow is picking a commit that depends
 * on earlier local-only commits not yet on the base — the merge then conflicts
 * with content the base hasn't seen. Detect that case explicitly so the caller
 * (often an LLM) gets a clear next step instead of a generic "conflict".
 */
async function buildPickError(
  git: SimpleGit,
  sha: string,
  base: string,
  baseSha: string,
  parentSha: string,
  conflictLines: string[],
): Promise<Error> {
  const conflictFiles = [
    ...new Set(conflictLines.map(line => line.split('\t').slice(1).join('\t'))),
  ];

  // Local commits between `base` and the picked commit's parent that touched
  // any conflicting file are candidate blockers — the actual conflict is
  // caused by at least one of them. We don't narrow further (would require
  // blaming the conflicting regions specifically), but in this workflow
  // history is linear so any narrower set would still need to be on the
  // remote alongside its ancestors.
  const candidateLog = (
    await git.raw([
      'log',
      '--reverse',
      '--format=%h %s',
      `${baseSha}..${parentSha}`,
      '--',
      ...conflictFiles,
    ])
  ).trim();

  const fileList = conflictFiles.map(file => `- ${file}`).join('\n');
  const header = `Cannot cherry-pick ${sha.slice(0, 8)} onto tip of ${base}, merge conflicts in:\n${fileList}`;

  if (!candidateLog) {
    return new Error(header);
  }

  const candidates = candidateLog.split('\n');
  const candidateList = candidates.map(line => `- ${line}`).join('\n');

  return new Error(
    `${header}\n\n${candidates.length} earlier local commit(s) changed those file(s):\n${candidateList}`,
  );
}

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

  // `git merge-tree --write-tree` exits non-zero on conflicts, but simple-git's
  // .raw does not surface that — it just returns stdout. On success stdout is
  // a single tree OID; on conflict it's the tree OID followed by lines of
  // `<mode> <oid> <stage>\t<path>`. Detect the conflict case explicitly.
  const mergeOutput = (
    await git.raw([
      'merge-tree',
      '--write-tree',
      '--no-messages',
      `--merge-base=${parentSha}`,
      baseSha,
      sha,
    ])
  ).trim();

  const [treeOid, ...conflictLines] = mergeOutput.split('\n');

  if (conflictLines.length > 0) {
    throw await buildPickError(git, sha, base, baseSha, parentSha, conflictLines);
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
