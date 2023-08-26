import {
  CreatePullRequestInput,
  PullRequest,
  RequestReviewsInput,
} from '@octokit/graphql-schema';
import {gql} from 'graphql-request';

import {paginatedRequest, request} from './graphql';
import {RepoKey} from './types';

export async function getRepoInfo(repo: RepoKey) {
  const repoGql = gql`
    query repo($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
        defaultBranchRef {
          name
        }
      }
    }
  `;

  let resp: any | null = null;

  try {
    resp = await request(repoGql, {...repo});
  } catch {
    return null;
  }

  return {
    repoId: resp.repository.id as string,
    defaultBranch: resp.repository.defaultBranchRef.name as string,
  };
}

/**
 * Get your open pull requests for this repo
 */
export async function getPulls(repo: RepoKey) {
  const user = await request(gql`
    query {
      viewer {
        login
      }
    }
  `);

  const author = user.viewer.login;

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
    {query: `is:pr is:open author:${author} repo:${repo.fullName}`},
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
