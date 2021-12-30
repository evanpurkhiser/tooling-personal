#!/usr/bin/env node

import yargs from 'yargs';

import pr from './cmd/pr';
import selectCommit from './cmd/select-commit';

yargs(process.argv.slice(2))
  .command('pr', 'Create and update PRs', pr)
  .command('select-commit', 'Select a commit hash', selectCommit)
  .demandCommand(1, '')
  .parse();
