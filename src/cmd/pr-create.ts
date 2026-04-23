import chalk from 'chalk';
import open from 'open';
import simpleGit from 'simple-git';

import {Assignee, AssigneeType, getAssignees} from '../assignees';
import {cherryPickOnto} from '../cherry-pick';
import {
  createPull,
  enableAutoMerge,
  getPulls,
  getRepoInfo,
  requestReview,
} from '../pulls';
import {RepoKey} from '../types';
import {branchFromMessage, getBranchNames, getEmailUsername, getRepoKey} from '../utils';

interface Args {
  sha: string;
  title: string;
  reviewer?: string;
  draft?: boolean;
  autoMerge?: boolean;
  updateOnly?: boolean;
  noOpen?: boolean;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }
  process.stdin.setEncoding('utf8');
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data.trim();
}

function parseSlugs(input: string | undefined): string[] {
  return (input ?? '')
    .split(',')
    .map(s => s.trim().replace(/^@/, ''))
    .filter(Boolean);
}

async function resolveReviewers(repo: RepoKey, slugs: string[]): Promise<Assignee[]> {
  if (slugs.length === 0) {
    return [];
  }

  const want = new Set(slugs.map(s => s.toLowerCase()));
  const found: Assignee[] = [];

  for await (const assignee of getAssignees(repo)) {
    const key = assignee.slug.toLowerCase();
    if (want.has(key)) {
      found.push(assignee);
      want.delete(key);
      if (want.size === 0) {
        break;
      }
    }
  }

  if (want.size > 0) {
    throw new Error(`Could not resolve reviewer(s): ${[...want].join(', ')}`);
  }

  return found;
}

export async function prCreate(argv: Args) {
  if (!argv.title && !argv.updateOnly) {
    throw new Error('--title is required when creating a PR');
  }

  const username = await getEmailUsername();
  const repo = await getRepoKey();
  const {head, origin} = await getBranchNames();

  if (head === null) {
    throw new Error('Cannot determine HEAD branch name');
  }

  if (origin === null) {
    throw new Error('Cannot determine upstream HEAD branch name');
  }

  const body = await readStdin();

  const unpublished = simpleGit().log({from: 'HEAD', to: origin});

  const [repoDetails, commits, prs] = await Promise.all([
    getRepoInfo(repo),
    unpublished,
    getPulls(repo),
  ]);

  if (repoDetails === null) {
    throw new Error('Failed to get repository ID');
  }

  const commit = commits.all.find(c => c.hash.startsWith(argv.sha));
  if (!commit) {
    throw new Error(`Commit ${argv.sha} not found in unpublished commits`);
  }

  const branchName = branchFromMessage(username, commit.message);
  const existingPr = prs.find(p => p.headRefName === branchName);

  if (argv.updateOnly && !existingPr) {
    throw new Error(`No existing PR for branch ${branchName}`);
  }

  const reviewerSlugs = parseSlugs(argv.reviewer);
  // Reviewers only apply on PR creation (matches `pt pr` behavior).
  const reviewers = existingPr ? [] : await resolveReviewers(repo, reviewerSlugs);

  console.error(chalk.gray(`Cherry-picking ${commit.hash.slice(0, 8)} onto ${origin}`));
  const newSha = await cherryPickOnto(commit.hash, origin);

  console.error(chalk.gray(`Pushing ${branchName}`));
  await simpleGit().push(['--force', 'origin', `${newSha}:refs/heads/${branchName}`]);

  if (existingPr) {
    const url = `https://github.com/${repo.fullName}/pull/${existingPr.number}`;
    console.error(
      chalk.green(`Updated existing PR #${existingPr.number}: ${existingPr.title}`),
    );
    console.log(url);
    return;
  }

  console.error(chalk.gray('Creating Pull Request'));
  const {createPullRequest} = await createPull({
    baseRefName: repoDetails.defaultBranch,
    headRefName: branchName,
    repositoryId: repoDetails.repoId,
    draft: argv.draft,
    title: argv.title,
    body,
  });
  const pr = createPullRequest.pullRequest;

  if (argv.autoMerge) {
    try {
      await enableAutoMerge({pullRequestId: pr.id, mergeMethod: 'SQUASH'});
    } catch {
      console.error(chalk.yellow('Auto merge not available, skipping'));
    }
  }

  if (reviewers.length > 0) {
    await requestReview({
      pullRequestId: pr.id,
      userIds: reviewers.filter(r => r.type === AssigneeType.User).map(r => r.id),
      teamIds: reviewers.filter(r => r.type === AssigneeType.Team).map(r => r.id),
    });
  }

  console.error(chalk.green(`Created PR: ${pr.url}`));
  console.log(pr.url);

  if (!argv.noOpen) {
    await open(pr.url);
  }
}
