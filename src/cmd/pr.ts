import {PullRequest} from '@octokit/graphql-schema';
import chalk from 'chalk';
import {Listr, ListrTask} from 'listr2';
import open from 'open';
import simpleGit, {DefaultLogFields, LogResult} from 'simple-git';

import {AssigneeType, selectAssignee} from '../assignees';
import {editPullRequest} from '../editor';
import {fzfSelect} from '../fzf';
import {
  createPull,
  enableAutoMerge,
  getPulls,
  getRepoInfo,
  requestReview,
} from '../pulls';
import {branchFromMessage, getBranchNames, getEmailUsername, getRepoKey} from '../utils';

function getCommits(to: string) {
  return simpleGit().log({from: 'HEAD', to});
}

interface Args {
  /**
   * Create PR as a draft
   */
  draft?: boolean;
  /**
   * Enable auto merge (squash) for the created PR?
   */
  autoMerge?: boolean;
}

export async function pr(argv: Args) {
  const username = await getEmailUsername();
  const repo = await getRepoKey();
  const {head, origin} = await getBranchNames();

  if (head === null) {
    throw new Error('Cannot determine HEAD branch name');
  }

  if (origin === null) {
    throw new Error('Cannot determine upstream HEAD branch name');
  }

  const rendererOptions = {showTimer: true};

  const collectInfoTask = new Listr<{
    repoId: string;
    defaultBranch: string;
    commits: LogResult;
    prs: PullRequest[];
  }>([], {
    concurrent: true,
    rendererOptions,
  });

  collectInfoTask.add({
    title: 'Fetching repository info',
    task: async (ctx, task) => {
      const details = await getRepoInfo(repo);

      if (details === null) {
        throw new Error('Failed to get repository ID');
      }

      task.title = 'Found repository';
      ctx.repoId = details.repoId;
      ctx.defaultBranch = details.defaultBranch;
    },
  });

  collectInfoTask.add({
    title: 'Getting unpublished commits',
    task: async (ctx, task) => {
      const commits = await getCommits(origin);

      if (commits.total === 0) {
        throw new Error('No commits to push');
      }

      task.title = `Found ${commits.total} publishable commits`;
      ctx.commits = commits;
    },
  });

  collectInfoTask.add({
    title: 'Fetching existing Pull Requests',
    task: async (ctx, task) => {
      ctx.prs = await getPulls(repo);
      task.title = `Found ${ctx.prs.length} existing PRs`;
    },
  });

  const {repoId, defaultBranch, commits, prs} = await collectInfoTask.run();

  const selectCommits = () =>
    fzfSelect<DefaultLogFields>({
      prompt: 'Select commit(s) for PR:',
      genValues: addOption =>
        commits.all.forEach(commit => {
          const branchName = branchFromMessage(username, commit.message);
          const pr = prs.find(pr => pr.headRefName === branchName);

          const existingPrLabel =
            pr !== undefined ? chalk.yellowBright`(updates #${pr.number})` : '';

          const shortHash = commit.hash.slice(0, 8);
          const label = chalk`{red ${shortHash}} {blue [${commit.author_name}]} {white ${commit.message}} ${existingPrLabel}`;

          addOption({label, id: commit.hash, ...commit});
        }),
    });

  // 01. Select which commits to turn into PRs
  const selectedCommits =
    commits.total === 1
      ? [{id: commits.all[0].hash, ...commits.all[0]}]
      : await selectCommits();

  const selectedShas = selectedCommits.map(option => option.hash);

  // 02. Re-order our commits when there are multiple
  //     commits and the selected commits are not already at
  //     the end of the list.
  const rebaseContents = [
    ...selectedShas,
    ...commits.all
      .filter(c => !selectedShas.includes(c.hash))
      .map(c => c.hash)
      .reverse(),
  ]
    .map(sha => `pick ${sha}`)
    .join('\n');

  const targetCommit = selectedCommits[selectedCommits.length - 1];
  const branchName = branchFromMessage(username, targetCommit.message);

  const willOpenPr = prs.some(pr => pr.headRefName === branchName);

  // 03. Rebase and push the selected commits
  const doRebase = async () => {
    const rebase = simpleGit()
      .env({...process.env, GIT_SEQUENCE_EDITOR: `echo "${rebaseContents}" >`})
      .rebase(['--interactive', '--autostash', origin]);

    try {
      await rebase;
    } catch (error) {
      // Abort a failed rebase
      await simpleGit().rebase(['--abort']);
      throw new Error(`Failed to rebase\n${error}`);
    }
  };

  const doPush = async () => {
    const newCommits = await getCommits(origin);
    const commitIdx = newCommits.all.length - selectedCommits.length;
    const rebaseTargetCommit = newCommits.all[commitIdx];

    const refSpec = `${rebaseTargetCommit.hash}:refs/heads/${branchName}`;
    await simpleGit().push(['--force', 'origin', refSpec]);
  };

  const rebaseAndPushTask = new Listr([], {rendererOptions});

  rebaseAndPushTask.add({title: 'Rebasing commits', task: doRebase});
  rebaseAndPushTask.add({title: 'Pushing to GitHub', task: doPush});

  // 04. Nothing left to do if we just updated an existing
  //     pull request.
  if (willOpenPr) {
    await rebaseAndPushTask.run();
    return;
  }

  // Cork stdout to avoid listr output polluting vim. We'll uncork after we
  // close vim
  process.stdout.cork();

  // 05. Open an editor to write the pull request
  const {editor, editorResult} = await editPullRequest(targetCommit);

  const rebaseAndPush = rebaseAndPushTask.run();
  rebaseAndPush.catch(() => editor.kill());

  const {title, body} = await editorResult;

  // XXX: We cork stdout here to avoid listr from corrupting vims output
  process.stdout.uncork();

  try {
    await rebaseAndPush;
  } catch {
    process.exit(1);
  }

  if (title.length === 0) {
    console.log(chalk.red`Missing PR title, aborting`);
    process.exit(1);
  }

  interface CreatePrTask {
    pr: PullRequest;
  }

  const createPrTask: ListrTask<CreatePrTask>['task'] = async ctx => {
    const pr = await createPull({
      baseRefName: defaultBranch,
      headRefName: branchName,
      repositoryId: repoId,
      draft: argv.draft,
      title,
      body,
    });
    ctx.pr = pr.createPullRequest.pullRequest;
  };

  const setAutoMergeTask: ListrTask<CreatePrTask>['task'] = async (ctx, task) => {
    const pullRequestId = ctx.pr.id;

    try {
      await enableAutoMerge({pullRequestId, mergeMethod: 'SQUASH'});
    } catch {
      task.skip('Auto Merge not available');
    }
  };

  const prTasks = new Listr<CreatePrTask>([], {rendererOptions});

  // 06-a. Create a Pull Request
  prTasks.add({
    title: 'Creating Pull Request',
    task: createPrTask,
  });

  // 06-a. Enable auto merge
  prTasks.add({
    enabled: !!argv.autoMerge,
    title: 'Enabling auto merge',
    task: setAutoMergeTask,
  });

  const asyncPrTasks = prTasks.run();

  // Do not let asyncPrTasks interfere with assignee selection
  process.stdout.cork();
  const reviewers = await selectAssignee(repo);
  const {pr} = await asyncPrTasks;
  process.stdout.uncork();

  // 07. Request reviews
  const reviewRequestTask = new Listr([], {rendererOptions});

  reviewRequestTask.add({
    enabled: () => reviewers.length > 0,
    title: 'Requesting Reviewers',
    task: () =>
      requestReview({
        pullRequestId: pr.id,
        userIds: reviewers.filter(a => a.type === AssigneeType.User).map(a => a.id),
        teamIds: reviewers.filter(a => a.type === AssigneeType.Team).map(a => a.id),
      }),
  });

  await reviewRequestTask.run();

  // 08. Open in browser
  open(pr.url);
}
