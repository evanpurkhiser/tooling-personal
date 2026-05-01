import {spawn} from 'node:child_process';

type Option = Record<string, any>;

interface OptionExtra {
  /**
   * The unique key of the option
   */
  id: string;
  /**
   * The label of the option
   */
  label: string;
}

type AddOptionFn<O extends Option> = (value: O & OptionExtra) => void;

interface FzfSelectOpts<O extends Option> {
  /**
   * The text displayed at the fzf prompt
   */
  prompt: string;
  /**
   * Allow selecting more than one option (fzf -m). Defaults to true.
   */
  multi?: boolean;
  /**
   * Function called to insert values into fzf. Input will be closed to fzf
   * after this function completes.
   */
  genValues: (addOption: AddOptionFn<O>) => Promise<void> | void;
}

export async function fzfSelect<O extends Option = Option>({
  prompt,
  multi = true,
  genValues,
}: FzfSelectOpts<O>) {
  const fzfArgs = [
    '--ansi',
    '--height=40%',
    '--reverse',
    `--header=${prompt}`,
    '--with-nth=2..',
  ];

  if (multi) {
    fzfArgs.push('-m');
  }

  const fzf = spawn('fzf', fzfArgs, {stdio: ['pipe', 'pipe', 'inherit']});

  fzf.stdin.setDefaultEncoding('utf-8');

  const options: Record<string, O & OptionExtra> = {};

  const valuesDone = genValues(option => {
    if (fzf.stdin.destroyed) {
      return;
    }
    options[option.id] = option;
    fzf.stdin.write(`${option.id}\t${option.label.trim()}\n`);
  });

  if (valuesDone instanceof Promise) {
    valuesDone.then(() => fzf.stdin.end());
  } else {
    fzf.stdin.end();
  }

  const output = await new Promise<string>(resolve =>
    fzf.stdout.once('data', d => resolve(d.toString())),
  );

  return output
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.split('\t')[0])
    .map(id => options[id]);
}
