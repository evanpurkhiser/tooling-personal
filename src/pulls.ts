import {PullRequest} from '@octokit/graphql-schema';
import {gql} from 'graphql-request';

import {githubClient, paginatedRequest} from './graphql';
import {getRepoUrl} from './utils';

/**
 * Get your open pull requests for this repo
 */
export async function getPulls() {
  const user = await githubClient.request(gql`
    query {
      viewer {
        login
      }
    }
  `);

  const author = user.viewer.login;
  const repo = getRepoUrl();

  const pullResults = paginatedRequest(
    gql`
      query myPullRequests($query: String!, $cursor: String) {
        search(query: $query, first: 100, type: ISSUE, after: $cursor) {
          edges {
            node {
              ... on PullRequest {
                number
                title
                headRefName
              }
            }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }
    `,
    {query: `is:pr is:open author:${author} repo:${repo.full_name}`},
    (obj: any) => obj.search.pageInfo
  );

  const prs: PullRequest[] = [];

  for await (const prPage of pullResults) {
    prs.push(...prPage.search.edges);
  }

  return prs;
}
