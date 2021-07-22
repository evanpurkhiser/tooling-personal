import {Organization, Repository} from '@octokit/graphql-schema';
import chalk from 'chalk';
import mergeIterable from 'fast-merge-async-iterators';
import {gql} from 'graphql-request';

import {fzfSelect} from './fzf';
import {paginatedRequest, request} from './graphql';
import {getRepoUrl} from './utils';

function isUser(obj: any): obj is {repository: Repository} {
  return obj.repository !== undefined;
}

/**
 * Generates a list of assignable teams and users
 */
async function* getAssignees() {
  const {owner, name: repo} = getRepoUrl();

  const assigneesGql = gql`
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
  `;

  const orgInfoGql = gql`
    query orgInfo($owner: String!) {
      organization(login: $owner) {
        name
      }
    }
  `;

  const teamGql = gql`
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
  `;

  let isOrganization = true;

  try {
    await request(orgInfoGql, {owner});
  } catch {
    isOrganization = false;
  }

  const userAssignees = paginatedRequest<{repository: Repository}>(
    assigneesGql,
    {owner, repo},
    (obj: any) => obj.repository.assignableUsers.pageInfo
  );

  const teamAssignees = !isOrganization
    ? null
    : paginatedRequest<{organization: Organization}>(
        teamGql,
        {owner},
        (obj: any) => obj.organization.teams.pageInfo
      );

  const items = !isOrganization
    ? userAssignees
    : mergeIterable(userAssignees, teamAssignees!);

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
export const selectAssignee = () =>
  fzfSelect({
    prompt: 'Select Assignees:',
    genValues: async addOption => {
      for await (const assignee of getAssignees()) {
        const name =
          assignee.name === null ? chalk.gray('No name') : chalk.yellow(assignee.name);
        const label = chalk`${assignee.slug} {white [}${name}{white ]}\n`;

        addOption({label, id: assignee.slug});
      }
    },
  });
