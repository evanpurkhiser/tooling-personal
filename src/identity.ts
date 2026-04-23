import {Repository} from '@octokit/graphql-schema';
import {gql} from 'graphql-request';

import fs from 'fs/promises';
import {join} from 'path';

import {paginatedRequest} from './graphql';
import {RepoKey} from './types';

interface CachedUser {
  login: string;
  name: string | null;
}

export interface Resolver {
  resolve(email: string, authorName?: string): string | null;
}

function cachePath(repo: RepoKey): string {
  const base = process.env.XDG_CACHE_HOME || join(process.env.HOME ?? '', '.cache');
  return join(base, 'pt', `assignees-${repo.owner}-${repo.repo}.json`);
}

async function readCache(repo: RepoKey): Promise<CachedUser[] | null> {
  try {
    const raw = await fs.readFile(cachePath(repo), 'utf8');
    return JSON.parse(raw) as CachedUser[];
  } catch {
    return null;
  }
}

async function writeCache(repo: RepoKey, users: CachedUser[]): Promise<void> {
  const path = cachePath(repo);
  await fs.mkdir(join(path, '..'), {recursive: true});
  await fs.writeFile(path, JSON.stringify(users));
}

/**
 * Fetch every assignable user for a repo. Cached to disk indefinitely; pass
 * `refresh` to force a refetch.
 */
export async function loadAssignableUsers(
  repo: RepoKey,
  opts: {refresh?: boolean} = {},
): Promise<CachedUser[]> {
  if (!opts.refresh) {
    const cached = await readCache(repo);
    if (cached) {
      return cached;
    }
  }

  // We don't request the `email` field here — it requires the
  // `user:email` scope, which `gh auth token` doesn't grant by default.
  const query = gql`
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

  const pages = paginatedRequest<{repository: Repository}>(
    query,
    {...repo},
    (obj: any) => obj.repository.assignableUsers.pageInfo,
  );

  const users: CachedUser[] = [];
  for await (const page of pages) {
    for (const node of page.repository.assignableUsers.nodes ?? []) {
      if (!node) {
        continue;
      }
      users.push({login: node.login, name: node.name ?? null});
    }
  }

  await writeCache(repo, users);
  return users;
}

/**
 * Extract the login from a GitHub noreply email.
 *
 *   `<id>+<login>@users.noreply.github.com`
 *   `<login>@users.noreply.github.com`
 */
function parseNoreplyLogin(email: string): string | null {
  const m = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/);
  return m ? m[1] : null;
}

/**
 * Strip emoji / punctuation, collapse whitespace, lowercase. Keeps letters
 * from any script plus spaces and hyphens.
 */
function normalizeName(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function nameTokens(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(/[\s-]+/)
      .filter(t => t.length >= 2),
  );
}

/**
 * Build a resolver mapping git author emails to GitHub logins. Tries in
 * order: noreply parse, exact name-to-login, normalized name match,
 * unambiguous token-subset match.
 */
export async function buildResolver(repo: RepoKey): Promise<Resolver> {
  const users = await loadAssignableUsers(repo);

  const loginIndex = new Map<string, string>();
  const nameIndex = new Map<string, string | null>();
  const tokenizedUsers: Array<{login: string; tokens: Set<string>}> = [];

  for (const u of users) {
    loginIndex.set(u.login.toLowerCase(), u.login);

    if (!u.name) {
      continue;
    }

    const key = normalizeName(u.name);
    if (key) {
      // Mark as ambiguous on collision so we never guess the wrong user.
      nameIndex.set(key, nameIndex.has(key) ? null : u.login);
    }

    const tokens = nameTokens(u.name);
    if (tokens.size > 0) {
      tokenizedUsers.push({login: u.login, tokens});
    }
  }

  function resolveByTokens(authorName: string): string | null {
    const authorTokens = nameTokens(authorName);
    if (authorTokens.size < 2) {
      return null;
    }

    const matches = tokenizedUsers.filter(u =>
      [...authorTokens].every(t => u.tokens.has(t)),
    );
    return matches.length === 1 ? matches[0].login : null;
  }

  return {
    resolve(email, authorName) {
      const noreply = parseNoreplyLogin(email);
      if (noreply) {
        return noreply;
      }

      if (!authorName) {
        return null;
      }

      const byLogin = loginIndex.get(authorName.toLowerCase().trim());
      if (byLogin) {
        return byLogin;
      }

      const byName = nameIndex.get(normalizeName(authorName));
      if (byName) {
        return byName;
      }

      return resolveByTokens(authorName);
    },
  };
}
