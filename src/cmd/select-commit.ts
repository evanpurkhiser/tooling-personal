import chalk from 'chalk';
import simpleGit, {DefaultLogFields} from 'simple-git';

import {fzfSelect} from '../fzf';

export default async function selectCommit() {
  const commits = await simpleGit().log({from: 'HEAD', to: 'origin/master'});

  const selected = await fzfSelect<DefaultLogFields>({
    prompt: 'Select commit(s):',
    genValues: addOption =>
      commits.all.forEach(commit => {
        const shortHash = commit.hash.slice(0, 8);
        const label = chalk`{red ${shortHash}} {blue [${commit.author_name}]} {white ${commit.message}}`;

        addOption({label, id: commit.hash, ...commit});
      }),
  });

  const commitHashes = selected.map(commit => commit.hash);

  console.log(commitHashes.join('\n'));
}
