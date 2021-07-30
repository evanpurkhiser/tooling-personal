#!/usr/bin/env node

import yargs from 'yargs';

import pr from './cmd/pr';

yargs(process.argv.slice(2))
  .command('pr', 'Create and update PRs', pr)
  .demandCommand(1, '')
  .parse();
