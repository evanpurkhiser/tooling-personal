#!/usr/bin/env node

import chalk from 'chalk';
import yargs from 'yargs';

import pr from './cmd/pr';
import selectCommit from './cmd/select-commit';

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
  .command('pr', 'Create and update PRs', pr)
  .command('select-commit', 'Select a commit hash', selectCommit)
  .demandCommand(1, '')
  .parse();
