#!/usr/bin/env node

import {PullRequest} from '@octokit/graphql-schema';
import chalk from 'chalk';
import {Listr} from 'listr2';
import open from 'open';
import {DefaultLogFields, LogResult} from 'simple-git';
import yargs from 'yargs';

import {AssigneeType, selectAssignee} from './assignees';
import {editPullRequest} from './editor';
import {fzfSelect} from './fzf';
import git from './git';
import {createPull, getGithubRepoId, getPulls, requestReview} from './pulls';
import {branchFromMessage} from './utils';

const getCommits = () => git.log({from: 'HEAD', to: 'origin/master'});

yargs(process.argv.slice(2))
  .command('pr', 'List assignees for repository', async () => {
    type Context = {
      /**
       * The ID of the repository
       */
      repoId: string;
      /**
       * The current list of commits
       */
      commits: LogResult;
      /**
       * The list of existing pull requests
       */
      prs: PullRequest[];
    };

    const infoTasks = new Listr<Context>([], {concurrent: true});

    infoTasks.add({
      title: 'Fetching repsotiry ID',
      task: async (ctx, task) => {
        const repoId = await getGithubRepoId();

        if (repoId === null) {
          throw new Error('Failed to get repository ID');
        }

        task.title = 'Got repository ID';
        ctx.repoId = repoId;
      },
    });

    infoTasks.add({
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

    infoTasks.add({
      title: 'Fetching existing Pull Requests',
      task: async (ctx, task) => {
        const prs = await getPulls();
        task.title = `Found ${prs.length} existing PRs`;
        ctx.prs = prs;

        task.stdout().write('TESTING\n');
      },
    });

    const {repoId, commits, prs} = await infoTasks.run();

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

    const triggerRebaseAndPush = async () => {
      await git
        .env('GIT_SEQUENCE_EDITOR', `echo "${rebaseContents}" >`)
        .rebase(['--interactive', '--autostash', 'origin/master']);

      const newCommits = await getCommits();
      const rebaseTargetCommit =
        newCommits.all[newCommits.all.length - selectedCommits.length];

      await git.push([
        '--force',
        'origin',
        `${rebaseTargetCommit.hash}:refs/heads/${branchName}`,
      ]);
    };

    // 03. Rebase and push the selected commits
    const rebaseAndPush = triggerRebaseAndPush();

    // 04. Nothing left to do if we just updated an existing
    //     pull request.
    if (prs.some(pr => pr.headRefName === branchName)) {
      const rebaseTask = new Listr([
        {title: 'Rebasing + Pushing', task: () => rebaseAndPush},
      ]);

      await rebaseTask.run();
      return;
    }

    // 05. Open an editor to write the pull request
    const {title, body} = await editPullRequest(targetCommit);

    if (title.length === 0) {
      console.log(chalk.red`Missing PR title`);
      process.exit(1);
    }

    // 06. Create a Pull Request
    await rebaseAndPush;

    const pr = createPull({
      baseRefName: 'master',
      headRefName: branchName,
      repositoryId: repoId,
      title,
      body,
    });

    const [{createPullRequest}, reviewers] = await Promise.all([pr, selectAssignee()]);

    await requestReview({
      pullRequestId: createPullRequest.pullRequest.id,
      userIds: reviewers.filter(a => a.type === AssigneeType.User).map(a => a.id),
      teamIds: reviewers.filter(a => a.type === AssigneeType.Team).map(a => a.id),
    });

    open(createPullRequest.pullRequest.url);
  })
  .demandCommand(1, '')
  .parse();
