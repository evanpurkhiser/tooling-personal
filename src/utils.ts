import gitUrlParse from 'git-url-parse';
import yaml from 'js-yaml';
import simpleGit from 'simple-git';

import {readFileSync} from 'fs';
import path from 'path';

const BRANCH_PREFIX = 'evanpurkhiser/';

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
 * Get's the absolute path to the current git repo
 */
export async function getRepoPath() {
  const path = await simpleGit().revparse(['--show-toplevel']);
  return path.trim();
}

/**
 * Get's the GitHub Oauth token from the hub config
 */
export function getHubToken() {
  const hubFile = path.join(process.env.XDG_CONFIG_HOME ?? '~/.config', 'hub');
  const hubConfig = yaml.load(readFileSync(hubFile).toString()) as Record<string, any>;

  return hubConfig['github.com'][0]['oauth_token'];
}

/**
 * Generates a consistent branch name from a commit message
 */
export function branchFromMessage(commitMessage: string) {
  const branch = commitMessage
    .toLowerCase()
    .replaceAll(/[^0-9a-zA-Z]/g, '-')
    .replaceAll(/-+/g, '-')
    .slice(0, 255);

  return BRANCH_PREFIX + branch;
}
