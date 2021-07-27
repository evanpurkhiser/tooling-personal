import {DefaultLogFields} from 'simple-git';

import {spawn} from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import {getRepoPath} from './utils';

export async function editPullRequest(commit: DefaultLogFields) {
  const messageBody = commit.body;
  const split = messageBody.length > 0 ? '\n\n' : '';
  const prTemplate = `${commit.message}${split}${messageBody}`;

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

  return {title, body};
}
