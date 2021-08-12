import path from 'path';
import { promises as fs } from 'fs';
import minimist from 'minimist';
import chalk from 'chalk';

const Units = {
  s: 1e6,
  ms: 1e3,
  us: 1,
  μs: 1,
};

const argv = minimist(process.argv.slice(2), {
  boolean: ['me'],
  default: {
    path: 'codes.txt', // Default location to resolve file from
    limit: 800, // Number of signals before cutoff 128 * 6 + margin
    unit: 's', // Unit the timings are specified in
    deviation: 1.1, // Noise deviation
    pause: 4, // Consider pause between sequences: `short + long * pause`
    sync: 1.5, // Consider sync signal: `short + long * sync`
    bits: 32, // Filter out sequences not matching bits length
    me: true, // Manchester encoding
    input: 'all', // Debug specific input only or all
  },
});

interface SequenceData {
  mean: number;
  short: number;
  long: number;
  pulse: number;
  sequence: number[];
  sequences: number[][];
}

async function fetchData(codesFile: string, limit: number) {
  const raw = await fs.readFile(path.resolve(codesFile), 'utf-8');
  const res: { [button: string]: number[] } = {};
  const lines = raw.split('\n');
  let group: number[] = [];
  for (const line of lines) {
    if (/^[a-z]/i.test(line)) {
      res[line.trim()] = group = [];
    } else {
      if (group.length <= limit) group.push(parseFloat(line));
    }
  }
  return res;
}

function calculateAverages(sequence: number[]) {
  // Clone and sort from smallest to largest
  const values = sequence.slice().sort((a, b) => a - b);

  // Remove first and last 10 % to reduce outliers
  const trimmed = values.slice(Math.floor(values.length * 0.1), Math.ceil(values.length * 0.9));

  // Calculate averages
  const mean = Math.round(trimmed.reduce((n1, n2) => n1 + n2) / trimmed.length);
  const short = trimmed[(trimmed.length * 0.25) << 0] << 0; // lower median
  const long = trimmed[(trimmed.length * 0.75) << 0] << 0; // upper median
  const pulse = (short / 2) << 0; // median pulse length

  return { mean, short, long, pulse };
}

function extractSequenceData(raw: number[]) {
  // Normalize output to microseconds
  const normalized = raw.map((n) => n * (Units[argv.unit as keyof typeof Units] || 1));

  // Join frequency modulation pairs
  const modulated: number[] = [];
  for (let i = 0; i < normalized.length; i += 2) {
    modulated.push(normalized[i] + normalized[i + 1]);
  }

  // Calculate averages
  const average = calculateAverages(modulated);
  const result: SequenceData = {
    ...average,
    sequence: [],
    sequences: [],
  };

  let sequences: number[][] = [[]];
  for (let i = 0; i < modulated.length; i++) {
    const sequence = sequences[sequences.length - 1];
    const timing = modulated[i];

    if (timing > average.long * argv.pause) {
      // Pause
      sequences.push([]);
      continue;
    }

    if (timing > average.long * argv.sync) {
      // Sync
      continue;
    }

    sequence.push(timing < average.short * argv.deviation ? 1 : 0);
  }

  // Filter out empty sequences
  sequences = sequences.filter((s) => parseInt(s.join(''), 2) > 0);

  // Filter out too short sequences
  if (argv.bits) sequences = sequences.filter((s) => (s.length = argv.bits * (argv.me != false ? 2 : 1)));

  // Decode manchester encoding
  if (argv.me != false) {
    sequences = sequences.map((sequence) => {
      const decodedSequence = [];
      for (let i = 0; i < sequence.length; i += 2) {
        // 10 => 1 and 01 => 0
        decodedSequence.push(sequence[i] ? 1 : 0);
      }
      return decodedSequence;
    });
  }

  // Update result sequences
  result.sequences = sequences;

  // Select the most common occurring sequence
  result.sequence = sequences.slice().sort((a, b) => {
    const s1 = a.join('');
    const s2 = b.join('');
    return sequences.filter((v) => v.join('') === s1).length - sequences.filter((v) => v.join('') === s2).length;
  })[sequences.length - 1];

  return result;
}

function print(name: string, data: SequenceData, detailed = false) {
  console.log(
    `[${chalk.cyan(name.toUpperCase())}] | Pulse: ${chalk.green((data.short / 2) << 0)} μs | Mean: ${chalk.green(
      data.mean
    )} μs | Short: ${chalk.red(data.short)} μs | Long: ${chalk.blue(data.long)} μs |`
  );
  console.log(
    `Mode: ${data.sequence.length} bits: ${chalk.magenta(parseInt(data.sequence.join(''), 2))} = ${chalk.yellow(
      data.sequence.join('')
    )}\n`
  );
  if (detailed) {
    console.log(chalk.cyan(`All extracted sequences:`));
    for (const sequence of data.sequences) {
      console.log(
        `${sequence.length} bits: ${chalk.magenta(parseInt(sequence.join(''), 2))} = ${chalk.yellow(sequence.join(''))}`
      );
    }
  }
}

async function main() {
  const buttons = await fetchData(argv.path, argv.limit);
  if (argv.input == 'all') {
    for (const button in buttons) {
      const sequences = buttons[button];
      const data = extractSequenceData(sequences);
      print(button, data);
    }
  } else {
    const sequences = buttons[argv.input];
    const data = extractSequenceData(sequences);
    print(argv.input, data, true);
  }
}

main();
