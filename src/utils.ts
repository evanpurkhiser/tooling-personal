import gitUrlParse from 'git-url-parse';
import yaml from 'js-yaml';

import childProcess from 'child_process';
import {readFileSync} from 'fs';
import path from 'path';

/**
 * Get's the current repo information
 */
export function getRepoUrl() {
  try {
    const url = childProcess.execSync('git config --get remote.origin.url').toString();
    return gitUrlParse(url);
  } catch {
    process.exit(1);
  }
}

export function getRepoPath() {
  return childProcess.execSync('git rev-parse --show-toplevel').toString().trim();
}

/**
 * Get's the GitHub Oauth token from the hub config
 */
export function getHubToken() {
  const hubFile = path.join(process.env.XDG_CONFIG_HOME ?? '~/.config', 'hub');
  const hubConfig = yaml.load(readFileSync(hubFile).toString()) as Record<string, any>;

  return hubConfig['github.com'][0]['oauth_token'];
}

const BRANCH_PREFIX = 'evanpurkhiser/';

/**
 * Generates a consistent branch name from a commit message
 */
export function branchFromMessage(commitMessage: string) {
  const branch = commitMessage
    .replace(/[^0-9a-zA-Z ]/g, '-')
    .replace(' ', '-')
    .slice(0, 255);

  return BRANCH_PREFIX + branch;
}
