import simpleGit from 'simple-git';

export interface HunkRange {
  start: number;
  end: number;
}

export interface FileHunks {
  file: string;
  hunks: HunkRange[];
}

export interface BlameResult {
  fileLines: Map<string, number>;
  hunkLines: Map<string, number>;
  authorNames: Map<string, string>;
  fileTotal: number;
  hunkTotal: number;
}

function hunkFromHeader(line: string, contextWindow: number): HunkRange | null {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))?/);
  if (!match) {
    return null;
  }

  const oldStart = Number(match[1]);
  const oldCount = match[2] === undefined ? 1 : Number(match[2]);

  if (oldCount === 0) {
    return {
      start: Math.max(1, oldStart - contextWindow + 1),
      end: oldStart + contextWindow,
    };
  }

  return {start: oldStart, end: oldStart + oldCount - 1};
}

function parseFileSection(section: string, contextWindow: number): FileHunks | null {
  const lines = section.split('\n');
  const fromLine = lines.find(l => l.startsWith('--- '));
  const toLine = lines.find(l => l.startsWith('+++ '));

  if (!fromLine || !toLine) {
    return null;
  }

  const fromPath = fromLine.slice(4);
  const toPath = toLine.slice(4);

  // Skip added files (no prior history) and deleted files.
  if (fromPath === '/dev/null' || toPath === '/dev/null') {
    return null;
  }

  // Blame the old path at `rev` so rename-with-edits hits the right file.
  const file = fromPath.startsWith('a/') ? fromPath.slice(2) : fromPath;

  const hunks = lines
    .filter(l => l.startsWith('@@'))
    .map(l => hunkFromHeader(l, contextWindow))
    .filter((r): r is HunkRange => r !== null);

  return hunks.length > 0 ? {file, hunks} : null;
}

/**
 * Parse a unified diff into per-file old-side line ranges. Pure insertions
 * expand to a small context window so nearby lines still contribute. Added
 * files (from /dev/null) are skipped.
 */
export function parseDiff(diff: string, contextWindow = 3): FileHunks[] {
  return diff
    .split(/^diff --git /m)
    .slice(1)
    .map(section => parseFileSection(section, contextWindow))
    .filter((f): f is FileHunks => f !== null);
}

function mergeRanges(ranges: HunkRange[]): HunkRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: HunkRange[] = [{...sorted[0]}];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= last.end + 1) {
      last.end = Math.max(last.end, curr.end);
    } else {
      merged.push({...curr});
    }
  }

  return merged;
}

function lineInRanges(line: number, ranges: HunkRange[]): boolean {
  return ranges.some(r => line >= r.start && line <= r.end);
}

/**
 * Blame the full file at `rev`, tallying per-author totals over the whole
 * file and the subset of lines inside the given hunk ranges.
 */
export async function blameFile(
  file: string,
  hunks: HunkRange[],
  rev: string,
): Promise<BlameResult> {
  const empty: BlameResult = {
    fileLines: new Map(),
    hunkLines: new Map(),
    authorNames: new Map(),
    fileTotal: 0,
    hunkTotal: 0,
  };

  let output: string;
  try {
    output = await simpleGit().raw(['blame', '--porcelain', rev, '--', file]);
  } catch {
    return empty;
  }

  const merged = mergeRanges(hunks);

  const shaToEmail = new Map<string, string>();
  const shaToName = new Map<string, string>();
  const entries: Array<{sha: string; finalLine: number}> = [];

  // 01. Parse porcelain into per-line blame entries + per-sha author headers
  for (const line of output.split('\n')) {
    const shaMatch = line.match(/^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/);
    if (shaMatch) {
      entries.push({sha: shaMatch[1], finalLine: Number(shaMatch[2])});
      continue;
    }

    const last = entries[entries.length - 1];
    if (!last) {
      continue;
    }

    if (line.startsWith('author-mail ')) {
      const email = line.slice('author-mail '.length).replace(/^<|>$/g, '');
      if (!shaToEmail.has(last.sha)) {
        shaToEmail.set(last.sha, email);
      }
    } else if (line.startsWith('author ')) {
      const name = line.slice('author '.length);
      if (!shaToName.has(last.sha)) {
        shaToName.set(last.sha, name);
      }
    }
  }

  // 02. Tally per-author counts, splitting hunk vs file totals
  const fileLines = new Map<string, number>();
  const hunkLines = new Map<string, number>();
  const authorNames = new Map<string, string>();
  let fileTotal = 0;
  let hunkTotal = 0;

  for (const {sha, finalLine} of entries) {
    const email = shaToEmail.get(sha);
    if (!email) {
      continue;
    }

    fileLines.set(email, (fileLines.get(email) ?? 0) + 1);
    fileTotal++;

    if (lineInRanges(finalLine, merged)) {
      hunkLines.set(email, (hunkLines.get(email) ?? 0) + 1);
      hunkTotal++;
    }

    const name = shaToName.get(sha);
    if (name && !authorNames.has(email)) {
      authorNames.set(email, name);
    }
  }

  return {fileLines, hunkLines, authorNames, fileTotal, hunkTotal};
}

/**
 * Blame every file in parallel and fold the per-file results together.
 */
export async function aggregateBlame(
  fileHunks: FileHunks[],
  rev: string,
): Promise<BlameResult> {
  const results = await Promise.all(
    fileHunks.map(({file, hunks}) => blameFile(file, hunks, rev)),
  );

  const agg: BlameResult = {
    fileLines: new Map(),
    hunkLines: new Map(),
    authorNames: new Map(),
    fileTotal: 0,
    hunkTotal: 0,
  };

  for (const r of results) {
    agg.fileTotal += r.fileTotal;
    agg.hunkTotal += r.hunkTotal;

    for (const [email, n] of r.fileLines) {
      agg.fileLines.set(email, (agg.fileLines.get(email) ?? 0) + n);
    }
    for (const [email, n] of r.hunkLines) {
      agg.hunkLines.set(email, (agg.hunkLines.get(email) ?? 0) + n);
    }
    for (const [email, name] of r.authorNames) {
      if (!agg.authorNames.has(email)) {
        agg.authorNames.set(email, name);
      }
    }
  }

  return agg;
}
