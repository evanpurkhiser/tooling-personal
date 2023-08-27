import convict from 'convict';
import yaml from 'js-yaml';

import {join} from 'path';

convict.addParser({extension: ['yml', 'yaml'], parse: yaml.load});

interface Config {
  /**
   * Assignee names / teams to ignore. Should be a regex expression.
   */
  ignoreAssignees: string[];
}

const config = convict<Config>({
  ignoreAssignees: {
    doc: 'Assignee names / teams to ignore. Should be a regex expression.',
    format: Array,
    default: [],
  },
});

const home = process.env.HOME!;
const configDir = process.env.XDG_CONFIG_HOME || join(home, '.config');

config.loadFile(join(configDir, 'pt', 'config.yml'));
config.validate();

export {Config, config};
