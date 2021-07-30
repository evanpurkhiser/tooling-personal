import {PullRequest} from '@octokit/graphql-schema';
import chalk from 'chalk';
import {Listr} from 'listr2';
import open from 'open';
import {DefaultLogFields, LogResult} from 'simple-git';

import {AssigneeType, selectAssignee} from '../assignees';
import {editPullRequest} from '../editor';
import {fzfSelect} from '../fzf';
import git from '../git';
import {createPull, getGithubRepoId, getPulls, requestReview} from '../pulls';
import {branchFromMessage} from '../utils';

const getCommits = () => git.log({from: 'HEAD', to: 'origin/master'});

export default async function pr() {
  const rendererOptions = {showTimer: true};

  const collectInfoTask = new Listr<{
    repoId: string;
    commits: LogResult;
    prs: PullRequest[];
  }>([], {
    concurrent: true,
    rendererOptions,
  });

  collectInfoTask.add({
    title: 'Fetching repsotiry ID',
    task: async (ctx, task) => {
      const repoId = await getGithubRepoId();

      if (repoId === null) {
        throw new Error('Failed to get repository ID');
      }

      task.title = 'Found repository ID';
      ctx.repoId = repoId;
    },
  });

  collectInfoTask.add({
    title: 'Getting unpublished commits',
    task: async (ctx, task) => {
      const commits = await getCommits();

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
      ctx.prs = await getPulls();
      task.title = `Found ${ctx.prs.length} existing PRs`;
    },
  });

  const {repoId, commits, prs} = await collectInfoTask.run();

  const selectCommits = () =>
    fzfSelect<DefaultLogFields>({
      prompt: 'Select commit(s) for PR:',
      genValues: addOption =>
        commits.all.forEach(commit => {
          const branchName = branchFromMessage(commit.message);
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
    ...commits.all.filter(c => !selectedShas.includes(c.hash)).map(c => c.hash),
  ]
    .map(sha => `pick ${sha}`)
    .join('\n');

  const targetCommit = selectedCommits[selectedCommits.length - 1];
  const branchName = branchFromMessage(targetCommit.message);

  const willOpenPr = prs.some(pr => pr.headRefName === branchName);

  // 03. Rebase and push the selected commits
  const doRebase = async () => {
    await git
      .env('GIT_SEQUENCE_EDITOR', `echo "${rebaseContents}" >`)
      .rebase(['--interactive', '--autostash', 'origin/master']);
  };

  const doPush = async () => {
    const newCommits = await getCommits();
    const commitIdx = newCommits.all.length - selectedCommits.length;
    const rebaseTargetCommit = newCommits.all[commitIdx];

    const refSpec = `${rebaseTargetCommit.hash}:refs/heads/${branchName}`;
    await git.push(['--force', 'origin', refSpec]);
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

  process.stdout.cork();
  const rebaseAndPush = rebaseAndPushTask.run();

  const {title, body} = await editPullRequest(targetCommit);

  // 05. Open an editor to write the pull request

  // XXX: We cork stdout here to avoid listr from corrupting vims output
  process.stdout.uncork();
  await rebaseAndPush;

  if (title.length === 0) {
    console.log(chalk.red`Missing PR title, aborting`);
    process.exit(1);
  }

  // 06. Create a Pull Request
  const pr = createPull({
    baseRefName: 'master',
    headRefName: branchName,
    repositoryId: repoId,
    title,
    body,
  });

  const reviewers = await selectAssignee();
  const {createPullRequest} = await pr;

  // 07. Request reviews
  const reviewRequestTask = new Listr([], {rendererOptions});

  reviewRequestTask.add({
    enabled: () => reviewers.length > 0,
    title: 'Requesting Reviewers',
    task: () =>
      requestReview({
        pullRequestId: createPullRequest.pullRequest.id,
        userIds: reviewers.filter(a => a.type === AssigneeType.User).map(a => a.id),
        teamIds: reviewers.filter(a => a.type === AssigneeType.Team).map(a => a.id),
      }),
  });

  await reviewRequestTask.run();

  // 08. Open in browser
  open(createPullRequest.pullRequest.url);
}
