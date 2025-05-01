import gitUrlParse from 'git-url-parse';
import simpleGit from 'simple-git';

import {execSync} from 'child_process';

/**
 * Get's the current repo information
 */
export async function getRepoKey() {
  const url = await simpleGit().listRemote(['--get-url', 'origin']);
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
 * Get's the "default" head and origin branch names
 */
export async function getBranchNames() {
  let head: null | string = null;
  let origin: null | string = null;

  try {
    head = await simpleGit().revparse(['--abbrev-ref', 'HEAD']);
  } catch {
    // null
  }

  try {
    origin = await simpleGit().revparse(['--abbrev-ref', '@{upstream}']);
  } catch {
    // null
  }

  return {head, origin};
}

/**
 * Get's the GitHub Oauth token from the gh auth token command
 */
export function getAccessToken() {
  try {
    return execSync('gh auth token').toString().trim();
  } catch {
    throw new Error('Cannot get token from `gh auth token`');
  }
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
