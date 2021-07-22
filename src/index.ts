import yargs from 'yargs';

import {selectAssignee} from './assignees';
import {getPulls} from './pulls';

yargs(process.argv.slice(2))
  .command('assignees', 'List assignees for repository', async () => {
    getPulls();

    //    console.log(await selectAssignee());
  })
  .demandCommand(1, '')
  .parse();
