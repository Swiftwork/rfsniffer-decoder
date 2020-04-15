import path from 'path';
import { promises as fs } from 'fs';
import minimist from 'minimist';
import chalk from 'chalk';

const argv = minimist(process.argv.slice(2), {
  boolean: ['pe'],
  default: {
    path: 'codes.txt',
    limit: 768,
    pe: true, // Phase encoding
  },
});

async function fetchData(codesFile: string, limit: number) {
  const raw = await fs.readFile(path.resolve(codesFile), 'utf-8');
  const res: { [button: string]: number[] } = {};
  const lines = raw.split('\n');
  let group: number[] = [];
  for (const line of lines) {
    if (/^[a-z]/i.test(line)) {
      res[line.trim()] = group = [];
    } else {
      if (group.length <= limit) group.push(parseFloat(line.slice(0, -2)));
    }
  }
  return res;
}

function calculateDeviation(sequence: number[]) {
  const values = sequence.slice();
  values.sort((a, b) => a - b);

  const filtered = values.slice(Math.floor(values.length * 0.25), Math.ceil(values.length * 0.8));
  const mean = Math.round(filtered.reduce((n1, n2) => n1 + n2) / filtered.length);
  const filteredShort = values.filter((n) => n < mean);
  const filteredLong = values.filter((n) => n >= mean);
  const short = filteredShort[(filteredShort.length / 2) << 0];
  const long = filteredLong[(filteredLong.length / 2) << 0];

  return { short, long, mean };
}

function extractSequence(raw: number[]) {
  const normalized = raw.map((n) => n * 1000000);
  const deviation = calculateDeviation(normalized);
  const result = {
    mean: deviation.mean,
    short: deviation.short,
    long: deviation.long,
    sequence: [] as number[],
    sequences: [] as number[][],
  };

  let sequences: number[][] = [[]];
  for (let i = 0; i < normalized.length; i += 2) {
    const sequence = sequences[sequences.length - 1];
    const timing = normalized[i] + normalized[i + 1];

    if (timing > deviation.short + deviation.long * 4) {
      // Pause
      sequences.push([]);
      continue;
    }

    if (timing > deviation.short + deviation.long * 1.5) {
      // Sync
      continue;
    }

    sequence.push(timing < (deviation.short + deviation.short) * 1.2 ? 1 : 0);
  }

  sequences = sequences.filter((s) => s.length >= 48);

  const sequence = sequences.sort((a, b) => {
    const s1 = a.join('');
    const s2 = b.join('');
    return sequences.filter((v) => v.join('') === s1).length - sequences.filter((v) => v.join('') === s2).length;
  })[sequences.length - 1];

  if (!sequence) return result;

  if (argv.pe != false) {
    for (let i = 0; i < sequence.length; i += 2) {
      // Merge phase encoding
      result.sequence.push(sequence[i] ? 1 : 0);
    }
  } else {
    result.sequence = sequence;
  }

  return result;
}

async function main() {
  const buttons = await fetchData(argv.path, argv.limit);
  for (const button in buttons) {
    const sequences = buttons[button];
    const data = extractSequence(sequences);
    console.log(
      `[${chalk.cyan(button.toUpperCase())}] | Mean: ${chalk.green(data.mean)} | Short: ${chalk.red(
        data.short
      )} | Long: ${chalk.blue(data.long)} |`
    );
    console.log(
      `${data.sequence.length} bits: ${chalk.magenta(parseInt(data.sequence.join(''), 2))} = ${chalk.yellow(
        data.sequence.join('')
      )}\n`
    );
  }
}

main();
