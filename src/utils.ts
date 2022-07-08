import gitUrlParse from 'git-url-parse';
import yaml from 'js-yaml';
import simpleGit from 'simple-git';

import {readFileSync} from 'fs';
import path from 'path';

/**
 * Get's the current repo information
 */
export async function getRepoKey() {
  const url = await simpleGit().raw('config', '--get', 'remote.origin.url');
  const repo = gitUrlParse(url);

  const repoKey = {
    owner: repo.owner,
    repo: repo.name,
    fullName: repo.full_name,
  };

  return repoKey;
}

/**
 * Get the git username from email
 */
export async function getEmailUsername() {
  const email = await simpleGit().raw('config', '--get', 'user.email');

  return email.split('@')[0].toLowerCase();
}

/**
 * Get's the absolute path to the current git repo
 */
export async function getRepoPath() {
  const path = await simpleGit().revparse(['--show-toplevel']);
  return path.trim();
}

/**
 * Get's the GitHub Oauth token from the hub config
 */
export function getAccessToken() {
  const hubFile = path.join(
    process.env.XDG_DATA_HOME ?? '~/.local/share',
    'tooling-personal',
    'auth.yml'
  );
  const hubConfig = yaml.load(readFileSync(hubFile).toString()) as Record<string, any>;

  return hubConfig['token'];
}

/**
 * Generates a consistent branch name from a commit message
 */
export function branchFromMessage(prefix: string, commitMessage: string) {
  const branch = commitMessage
    .toLowerCase()
    .replaceAll(/[^0-9a-zA-Z]/g, '-')
    .replaceAll(/-+/g, '-')
    .slice(0, 255);

  return `${prefix}/${branch}`;
}
