#!/usr/bin/env node

import chalk from 'chalk';
import yargs from 'yargs';

import {pr} from './cmd/pr';
import {prCreate} from './cmd/pr-create';
import {prUpdate} from './cmd/pr-update';
import {selectCommit} from './cmd/select-commit';
import {suggestAssignees} from './cmd/suggest-assignees';

yargs(process.argv.slice(2))
  .option('color', {
    boolean: true,
    desc: 'Use colored output (default: auto-detect)',
  })
  .middleware(args => {
    if (args.color !== undefined) {
      chalk.level = args.color ? 3 : 0;
    }
  }, true)
  .command(
    'pr',
    'Create and update PRs',
    y =>
      y
        .option('draft', {
          alias: 'd',
          boolean: true,
          desc: 'Create PR as a draft',
        })
        .option('autoMerge', {
          alias: 'm',
          boolean: true,
          desc: 'Enable auto merge for the PR',
        }),
    pr,
  )
  .command(
    'pr-create <sha>',
    'Non-interactively create a PR for a single commit. Body is read from stdin.',
    y =>
      y
        .positional('sha', {
          type: 'string',
          demandOption: true,
          desc: 'Commit SHA (full or prefix) to publish as a PR',
        })
        .option('title', {
          type: 'string',
          demandOption: true,
          desc: 'PR title',
        })
        .option('reviewer', {
          type: 'string',
          desc: 'Comma-separated list of reviewers (user logins or org/team slugs)',
        })
        .option('draft', {
          alias: 'd',
          boolean: true,
          desc: 'Create PR as a draft',
        })
        .option('autoMerge', {
          alias: 'm',
          boolean: true,
          desc: 'Enable auto merge for the PR',
        })
        .option('noOpen', {
          boolean: true,
          desc: 'Do not open the PR in the browser after creation',
        }),
    prCreate,
  )
  .command(
    'pr-update <sha>',
    'Non-interactively push an amended commit to its existing PR branch.',
    y =>
      y.positional('sha', {
        type: 'string',
        demandOption: true,
        desc: 'Commit SHA (full or prefix) whose PR branch should be updated',
      }),
    prUpdate,
  )
  .command(
    'suggest-assignees',
    'Suggest reviewers for current diff based on blame ownership',
    y =>
      y
        .option('commit', {
          type: 'string',
          desc: 'Analyze the files changed in this commit instead of staged changes',
        })
        .option('limit', {
          type: 'number',
          default: 3,
          desc: 'Max number of suggestions',
        })
        .option('format', {
          type: 'string',
          choices: ['slugs', 'json'] as const,
          default: 'slugs' as const,
          desc: 'Output format',
        })
        .option('hunkWeight', {
          type: 'number',
          default: 0.7,
          desc: 'Weight of hunk-level ownership vs whole-file ownership (0..1)',
        })
        .option('refresh', {
          boolean: true,
          desc: 'Ignore the cached assignable-users list and refetch',
        }),
    suggestAssignees,
  )
  .command('select-commit', 'Select a commit hash', selectCommit)
  .demandCommand(1, '')
  .parse();
