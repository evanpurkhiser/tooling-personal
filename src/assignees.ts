import {Organization, Repository} from '@octokit/graphql-schema';
import chalk from 'chalk';
import mergeIterable from 'fast-merge-async-iterators';
import {gql} from 'graphql-request';

import {spawn} from 'child_process';

import {paginatedRequest} from './graphql';

function isUser(obj: any): obj is {repository: Repository} {
  return obj.repository !== undefined;
}

/**
 * Generates a list of assignable teams and users
 */
async function* getAssignees() {
  const {owner, name: repo} = {owner: 'getsentry', name: 'sentry'}; // getRepoUrl();

  const userAssignees = paginatedRequest<{repository: Repository}>(
    gql`
      query userAssignees($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          assignableUsers(first: 100, after: $cursor) {
            nodes {
              login
              name
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `,
    {owner, repo},
    (obj: any) => obj.repository.assignableUsers.pageInfo
  );

  const teamAssignees = paginatedRequest<{organization: Organization}>(
    gql`
      query teamAssignees($owner: String!, $cursor: String) {
        organization(login: $owner) {
          teams(first: 100, after: $cursor) {
            nodes {
              combinedSlug
              name
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `,
    {owner},
    (obj: any) => obj.organization.teams.pageInfo
  );

  const items = mergeIterable(userAssignees, teamAssignees);

  for await (const result of items) {
    const assignees = isUser(result)
      ? result.repository.assignableUsers.nodes!.map(user => ({
          slug: user!.login,
          name: user!.name,
        }))
      : result.organization.teams.nodes!.map(team => ({
          slug: team!.combinedSlug,
          name: team!.name,
        }));

    yield* assignees;
  }
}

/**
 * Create a fzf prompt for selecting assignees for PRs / issues in this
 * repository.
 */
export async function selectAssignee() {
  const fzf = spawn(
    'fzf',
    [
      '--ansi',
      '--height=40%',
      '--reverse',
      '--header="Select Assignees:"',
      '--with-nth=2..',
      '-m',
    ],
    {shell: true, stdio: ['pipe', 'pipe', 'inherit']}
  );

  fzf.stdin.setDefaultEncoding('utf-8');

  for await (const assignee of getAssignees()) {
    const name =
      assignee.name === null ? chalk.gray('No name') : chalk.yellow(assignee.name);

    fzf.stdin.write(
      chalk`${assignee.slug}\t${assignee.slug} {white [}${name}{white ]}\n`
    );
  }
  fzf.stdin.end();

  const output = await new Promise<string>(resolve =>
    fzf.stdout.once('data', d => resolve(d.toString()))
  );

  return output
    .split('\n')
    .filter(a => a !== '')
    .map(a => a.split('\t')[0]);
}
