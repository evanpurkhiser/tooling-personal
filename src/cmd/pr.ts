import {PullRequest} from '@octokit/graphql-schema';
import chalk from 'chalk';
import {Listr} from 'listr2';
import open from 'open';
import simpleGit, {DefaultLogFields, LogResult} from 'simple-git';

import {AssigneeType, selectAssignee} from '../assignees';
import {editPullRequest} from '../editor';
import {fzfSelect} from '../fzf';
import {createPull, getGithubRepoId, getPulls, requestReview} from '../pulls';
import {branchFromMessage, getEmailUsername, getRepoKey} from '../utils';

function getCommits(to: string) {
  return simpleGit().log({from: 'HEAD', to});
}

export default async function pr() {
  const username = await getEmailUsername();
  const repo = await getRepoKey();

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
      const repoId = await getGithubRepoId(repo);

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
      const commits = await getCommits('origin/master');

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

  const {repoId, commits, prs} = await collectInfoTask.run();

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
      .rebase(['--interactive', '--autostash', 'origin/master']);

    try {
      await rebase;
    } catch (error) {
      // Abort a failed rebase
      await simpleGit().rebase(['--abort']);
      throw new Error(`Failed to rebase\n${error}`);
    }
  };

  const doPush = async () => {
    const newCommits = await getCommits('origin/master');
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

  // 06. Create a Pull Request
  const pr = createPull({
    baseRefName: 'master',
    headRefName: branchName,
    repositoryId: repoId,
    title,
    body,
  });

  const reviewers = await selectAssignee(repo);
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
