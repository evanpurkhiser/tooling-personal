import chalk from 'chalk';
import simpleGit from 'simple-git';

import {cherryPickOnto} from '../cherry-pick';
import {getPulls} from '../pulls';
import {branchFromMessage, getBranchNames, getEmailUsername, getRepoKey} from '../utils';

interface Args {
  sha: string;
}

export async function prUpdate(argv: Args) {
  const username = await getEmailUsername();
  const repo = await getRepoKey();
  const {head, origin} = await getBranchNames();

  if (head === null) {
    throw new Error('Cannot determine HEAD branch name');
  }

  if (origin === null) {
    throw new Error('Cannot determine upstream HEAD branch name');
  }

  const unpublished = simpleGit().log({from: 'HEAD', to: origin});

  const [commits, prs] = await Promise.all([unpublished, getPulls(repo)]);

  const commit = commits.all.find(c => c.hash.startsWith(argv.sha));
  if (!commit) {
    throw new Error(`Commit ${argv.sha} not found in unpublished commits`);
  }

  const branchName = branchFromMessage(username, commit.message);
  const existingPr = prs.find(p => p.headRefName === branchName);

  if (!existingPr) {
    throw new Error(
      `No existing PR for branch ${branchName}. Use 'pr-create' to open one.`,
    );
  }

  console.error(chalk.gray(`Cherry-picking ${commit.hash.slice(0, 8)} onto ${origin}`));
  const newSha = await cherryPickOnto(commit.hash, origin);

  console.error(chalk.gray(`Pushing ${branchName}`));
  await simpleGit().push(['--force', 'origin', `${newSha}:refs/heads/${branchName}`]);

  const url = `https://github.com/${repo.fullName}/pull/${existingPr.number}`;
  console.error(
    chalk.green(`Updated existing PR #${existingPr.number}: ${existingPr.title}`),
  );
  console.log(url);
}
