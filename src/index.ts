import chalk from 'chalk';
import yargs from 'yargs';

import {spawn} from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import {selectAssignee} from './assignees';
import {fzfSelect} from './fzf';
import git from './git';
import {getPulls} from './pulls';
import {branchFromMessage, getRepoPath} from './utils';

const getCommits = () => git.log({from: 'HEAD', to: 'origin/master'});

yargs(process.argv.slice(2))
  .command('pr', 'List assignees for repository', async () => {
    const [commits, prs] = await Promise.all([getCommits(), getPulls()]);

    if (commits.total === 0) {
      console.log(chalk.red`No commits after origin/master`);
    }

    // 01. Select which commits to turn into PRs
    const selectedCommits =
      commits.total === 1
        ? [commits.all[0].hash]
        : await fzfSelect({
            prompt: 'Select commit(s) for PR:',
            genValues: addOption =>
              commits.all.forEach(commit => {
                const branchName = branchFromMessage(commit.message);
                const pr = prs.find(pr => pr.baseRefName === branchName);

                const existingPrLabel =
                  pr !== undefined ? chalk.yellowBright`(updates #${pr.id})` : '';

                const shortHash = commit.hash.slice(0, 8);
                const label = chalk`{red ${shortHash}} {blue [${commit.author_name}]} {white ${commit.message}} ${existingPrLabel}`;

                addOption({label, id: commit.hash});
              }),
          });

    // 02. Re-order our commits when there are multiple
    //     commits and the selected commits are not already at
    //     the end of the list.
    const rebaseContents = [
      ...selectedCommits,
      ...commits.all.filter(c => !selectedCommits.includes(c.hash)).map(c => c.hash),
    ]
      .map(sha => `pick ${sha}`)
      .join('\n');

    await git
      .env('GIT_SEQUENCE_EDITOR', `echo "${rebaseContents}" >`)
      .rebase(['--interactive', '--autostash', 'origin/master']);

    // 03. Push commits
    const newCommits = await getCommits();
    const targetCommit = newCommits.all[selectedCommits.length - 1];
    const branchName = branchFromMessage(targetCommit.message);

    const gitPush = git.push([
      '--force',
      'origin',
      `${targetCommit.hash}:refs/heads/${branchName}`,
    ]);

    // 04. Nothing left to do if we just updated an existing
    //     pull request.
    if (prs.some(pr => pr.baseRefName === branchName)) {
      await gitPush;
      return;
    }

    // 05. Select assignees for the new PR
    const assignees = await selectAssignee();

    // 06. Open an editor to write the pull request
    const prContents = `${targetCommit.message}${
      targetCommit.body.length !== 0 ? `\n\n${targetCommit.body}` : ''
    }`;

    const pullInfoFile = path.join(getRepoPath(), '.git', 'PULLREQ_EDITMSG');

    await fs.writeFile(pullInfoFile, prContents);

    console.log('FILE WRITTEN');

    console.log(process.env.EDITOR);
    const editor = spawn(process.env.EDITOR ?? 'vim', [pullInfoFile], {
      shell: true,
      stdio: 'inherit',
    });

    await new Promise(resolve => editor.on('close', resolve));

    // console.log(await selectAssignee());
  })
  .demandCommand(1, '')
  .parse();
