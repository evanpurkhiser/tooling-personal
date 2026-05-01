import type {DefaultLogFields} from 'simple-git';

import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import {getRepoPath} from './utils';

export async function editPullRequest(commit: DefaultLogFields) {
  const messageBody = commit.body;
  const split = messageBody.length > 0 ? '\n\n' : '';
  const prTemplate = `${commit.message}${split}${messageBody}`;

  const pullEditFile = path.join(await getRepoPath(), '.git', 'PULLREQ_EDITMSG');
  await fs.writeFile(pullEditFile, prTemplate);

  const quotedFile = `'${pullEditFile.replace(/'/g, `'\\''`)}'`;
  const editor = spawn(`${process.env.EDITOR ?? 'vim'} ${quotedFile}`, {
    shell: true,
    stdio: 'inherit',
  });

  async function getResult() {
    await new Promise(resolve => editor.on('close', resolve));
    const prContents = await fs.readFile(pullEditFile).then(b => b.toString());

    const [title, ...bodyParts] = prContents.split('\n');
    const body = bodyParts.join('\n').trim();

    return {title, body};
  }

  return {editor, editorResult: getResult()};
}
