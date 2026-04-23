import simpleGit from 'simple-git';

import {aggregateBlame, parseDiff} from '../blame';
import {config} from '../config';
import {buildResolver} from '../identity';
import {getRepoKey} from '../utils';

interface Args {
  /**
   * Analyze the files changed in this commit instead of staged changes.
   */
  commit?: string;
  /**
   * Maximum number of suggestions to return.
   */
  limit: number;
  /**
   * Output format.
   */
  format: 'slugs' | 'json';
  /**
   * Weight of hunk-level ownership vs whole-file ownership (0..1).
   */
  hunkWeight: number;
  /**
   * Ignore the cached assignable-users list and refetch.
   */
  refresh?: boolean;
}

interface Scored {
  email: string;
  name?: string;
  login: string | null;
  fileLines: number;
  hunkLines: number;
  fileShare: number;
  hunkShare: number;
  score: number;
}

interface DiffSource {
  diff: string;
  rev: string;
  label: string;
}

async function getDiffSource(commit: string | undefined): Promise<DiffSource> {
  const git = simpleGit();

  if (commit) {
    const diff = await git.raw(['show', '-U0', '--format=', commit]);
    const rev = (await git.revparse([`${commit}^`])).trim();
    return {diff, rev, label: `commit ${commit}`};
  }

  const staged = await git.diff(['-U0', '--cached']);
  if (staged.trim()) {
    return {diff: staged, rev: 'HEAD', label: 'staged changes'};
  }

  const unstaged = await git.diff(['-U0']);
  if (unstaged.trim()) {
    return {diff: unstaged, rev: 'HEAD', label: 'unstaged changes'};
  }

  throw new Error('No staged or unstaged changes to suggest assignees for');
}

export async function suggestAssignees(argv: Args) {
  const repo = await getRepoKey();
  const selfEmail = (await simpleGit().raw('config', '--get', 'user.email')).trim();

  // 01. Figure out what we're scoring against (staged, unstaged, or a commit)
  const {diff, rev, label} = await getDiffSource(argv.commit);

  const fileHunks = parseDiff(diff);
  if (fileHunks.length === 0) {
    throw new Error(`No files with prior history in ${label}`);
  }

  // 02. Blame every file + resolve the repo's assignable user directory
  const [blame, resolver] = await Promise.all([
    aggregateBlame(fileHunks, rev),
    buildResolver(repo),
  ]);

  // 03. Score each author: weighted combination of hunk and file ownership
  const ignoreRegexes = config.get('ignoreAssignees').map(value => new RegExp(value));
  const emails = new Set<string>([...blame.fileLines.keys(), ...blame.hunkLines.keys()]);

  const scored: Scored[] = [];
  for (const email of emails) {
    if (email.toLowerCase() === selfEmail.toLowerCase()) {
      continue;
    }

    const login = resolver.resolve(email, blame.authorNames.get(email));
    if (login && ignoreRegexes.some(r => r.test(login))) {
      continue;
    }

    const fileLines = blame.fileLines.get(email) ?? 0;
    const hunkLines = blame.hunkLines.get(email) ?? 0;
    const fileShare = blame.fileTotal > 0 ? fileLines / blame.fileTotal : 0;
    const hunkShare = blame.hunkTotal > 0 ? hunkLines / blame.hunkTotal : 0;
    const score = hunkShare * argv.hunkWeight + fileShare * (1 - argv.hunkWeight);

    scored.push({
      email,
      name: blame.authorNames.get(email),
      login,
      fileLines,
      hunkLines,
      fileShare,
      hunkShare,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const resolved = scored.filter(s => s.login !== null);
  const unresolved = scored.filter(s => s.login === null);
  const top = resolved.slice(0, argv.limit);

  // 04. Render
  if (argv.format === 'slugs') {
    console.log(top.map(s => s.login).join(','));
    return;
  }

  console.log(
    JSON.stringify(
      {
        source: label,
        fileTotal: blame.fileTotal,
        hunkTotal: blame.hunkTotal,
        suggestions: top,
        unresolved,
      },
      null,
      2,
    ),
  );
}
