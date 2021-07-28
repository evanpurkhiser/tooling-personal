## Evan Purkhiser's Personal Tooling
test

This is a set of tools I use in my day to day at work.

### `pr`: Pull Request automation

The `pr` command creates or updates a pull request associated to
one or more commits. The tool handles the following:

 * Select which commits should be part of the PR
 * Generates a branch from the commit message, and pushes the
   commits up to the remote.
 * Prompts for reviewers to assign to the pull request.
 * Creates a pull request and assigns the selected reviewers.
