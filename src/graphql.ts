import {GraphQLClient} from 'graphql-request';

import {getHubToken} from './utils';

const authorization = `Bearer ${getHubToken()}`;

export const githubClient = new GraphQLClient('https://api.github.com/graphql', {
  headers: {authorization},
});

/**
 * Make a graphql request with automatic pagination
 */
export async function* paginatedRequest<T = any>(
  query: string,
  variables: Record<string, any>,
  pickCursor: (obj: any) => {endCursor: string; hasNextPage: boolean}
) {
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result = await githubClient.request<T>(query, {...variables, cursor});
    const pageInfo = pickCursor(result);

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;

    yield result;
  }
}
