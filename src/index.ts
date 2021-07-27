#!/usr/bin/env node

import chalk from 'chalk';
import open from 'open';
import yargs from 'yargs';

import {spawn} from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import {AssigneeType, selectAssignee} from './assignees';
import {fzfSelect} from './fzf';
import git from './git';
import {createPull, getGithubRepoId, getPulls, requestReview} from './pulls';
import {branchFromMessage, getRepoPath} from './utils';

const getCommits = () => git.log({from: 'HEAD', to: 'origin/master'});

yargs(process.argv.slice(2))
  .command('pr', 'List assignees for repository', async () => {
    const [repoId, commits, prs] = await Promise.all([
      getGithubRepoId(),
      getCommits(),
      getPulls(),
    ]);

    if (repoId === null) {
      console.log(chalk.red`No GitHub repository associated to this repo`);
      process.exit(1);
    }

    if (commits.total === 0) {
      console.log(chalk.red`No commits after origin/master`);
    }

    // 01. Select which commits to turn into PRs
    const selectedCommits =
      commits.total === 1
        ? [{id: commits.all[0].hash}]
        : await fzfSelect({
            prompt: 'Select commit(s) for PR:',
            genValues: addOption =>
              commits.all.forEach(commit => {
                const branchName = branchFromMessage(commit.message);
                const pr = prs.find(pr => pr.headRefName === branchName);

                const existingPrLabel =
                  pr !== undefined ? chalk.yellowBright`(updates #${pr.number})` : '';

                const shortHash = commit.hash.slice(0, 8);
                const label = chalk`{red ${shortHash}} {blue [${commit.author_name}]} {white ${commit.message}} ${existingPrLabel}`;

                addOption({label, id: commit.hash});
              }),
          });

    const selectedShas = selectedCommits.map(option => option.id);

    // 02. Re-order our commits when there are multiple
    //     commits and the selected commits are not already at
    //     the end of the list.
    const rebaseContents = [
      ...selectedShas,
      ...commits.all.filter(c => !selectedShas.includes(c.hash)).map(c => c.hash),
    ]
      .map(sha => `pick ${sha}`)
      .join('\n');

    await git
      .env('GIT_SEQUENCE_EDITOR', `echo "${rebaseContents}" >`)
      .rebase(['--interactive', '--autostash', 'origin/master']);

    // 03. Push commits
    const newCommits = await getCommits();
    const targetCommit = newCommits.all[newCommits.all.length - selectedCommits.length];
    const branchName = branchFromMessage(targetCommit.message);

    const gitPush = git.push([
      '--force',
      'origin',
      `${targetCommit.hash}:refs/heads/${branchName}`,
    ]);

    // 04. Nothing left to do if we just updated an existing
    //     pull request.
    if (prs.some(pr => pr.headRefName === branchName)) {
      await gitPush;
      return;
    }

    // 05. Open an editor to write the pull request
    const messageBody = targetCommit.body;
    const split = messageBody.length > 0 ? '\n\n' : '';
    const prTemplate = `${targetCommit.message}${split}${messageBody}`;

    const pullEditFile = path.join(getRepoPath(), '.git', 'PULLREQ_EDITMSG');
    await fs.writeFile(pullEditFile, prTemplate);

    const editor = spawn(process.env.EDITOR ?? 'vim', [pullEditFile], {
      shell: true,
      stdio: 'inherit',
    });

    await new Promise(resolve => editor.on('close', resolve));
    const prContents = await fs.readFile(pullEditFile).then(b => b.toString());

    const [title, ...bodyParts] = prContents.split('\n');
    const body = bodyParts.join('\n').trim();

    if (title.length === 0) {
      console.log(chalk.red`Missing PR title`);
      process.exit(1);
    }

    // 06. Create a Pull Request
    await gitPush;

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
