import {spawn} from 'child_process';

type FzfOption = {
  /**
   * The identifier returned from the selected value
   */
  id: string;
  /**
   * The label shown in fzf
   */
  label: string;
};

type AddOptionFn = (value: FzfOption) => void;

type FzfSelectOpts = {
  /**
   * The text displayed at the fzf prompt
   */
  prompt: string;
  /**
   * Function called to insert values into fzf. Input will be
   * closed to fzf after this function completes.
   */
  genValues: (addOption: AddOptionFn) => Promise<void> | void;
};

export async function fzfSelect({prompt, genValues}: FzfSelectOpts) {
  const fzf = spawn(
    'fzf',
    [
      '--ansi',
      '--height=40%',
      '--reverse',
      `--header="${prompt}"`,
      '--with-nth=2..',
      '-m',
    ],
    {shell: true, stdio: ['pipe', 'pipe', 'inherit']}
  );

  fzf.stdin.setDefaultEncoding('utf-8');

  await genValues(value => fzf.stdin.write(`${value.id}\t${value.label.trim()}\n`));
  fzf.stdin.end();

  const output = await new Promise<string>(resolve =>
    fzf.stdout.once('data', d => resolve(d.toString()))
  );

  return output
    .split('\n')
    .filter(a => a !== '')
    .map(a => a.split('\t')[0]);
}
