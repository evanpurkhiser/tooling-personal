#!/usr/bin/env node

import chalk from 'chalk';
import yargs from 'yargs';

import {pr} from './cmd/pr';
import {prCreate} from './cmd/pr-create';
import {selectCommit} from './cmd/select-commit';

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
    'Non-interactively create or update a PR for a single commit. Body is read from stdin.',
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
        .option('updateOnly', {
          boolean: true,
          desc: 'Only update an existing PR; fail if none exists for the generated branch',
        })
        .option('noOpen', {
          boolean: true,
          desc: 'Do not open the PR in the browser after creation',
        }),
    prCreate,
  )
  .command('select-commit', 'Select a commit hash', selectCommit)
  .demandCommand(1, '')
  .parse();
