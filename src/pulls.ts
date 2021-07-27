import {
  CreatePullRequestInput,
  PullRequest,
  RequestReviewsInput,
} from '@octokit/graphql-schema';
import {gql} from 'graphql-request';

import {paginatedRequest, request} from './graphql';
import {getRepoUrl} from './utils';

export async function getGithubRepoId() {
  const {owner, name: repo} = getRepoUrl();

  const repoGql = gql`
    query repo($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
      }
    }
  `;

  try {
    const resp = await request(repoGql, {owner, repo});
    return resp.repository.id as string;
  } catch {
    return null;
  }
}

/**
 * Get your open pull requests for this repo
 */
export async function getPulls() {
  const user = await request(gql`
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
                id
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
    prs.push(...prPage.search.edges.map((e: any) => e.node));
  }

  return prs;
}

/**
 * Creates a pull request
 */
export function createPull(input: CreatePullRequestInput) {
  const prGql = gql`
    mutation createPull($input: CreatePullRequestInput!) {
      createPullRequest(input: $input) {
        pullRequest {
          id
          url
        }
      }
    }
  `;

  return request<{createPullRequest: {pullRequest: PullRequest}}>(prGql, {input});
}

/**
 * Assign reviewers to an existing pull request
 */
export function requestReview(input: RequestReviewsInput) {
  const reviewerGql = gql`
    mutation requestReview($input: RequestReviewsInput!) {
      requestReviews(input: $input) {
        clientMutationId
      }
    }
  `;

  return request<void>(reviewerGql, {input});
}
