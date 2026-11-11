import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const CTRL_C = '\u0003';
const BACKSPACE = new Set(['\u007f', '\b']);

// When input is piped (CI, `echo ... |`), read it line by line instead of
// prompting. One shared iterator so consecutive questions get consecutive lines.
let pipedLines: AsyncIterator<string> | undefined;

const nextPipedLine = async (question: string): Promise<string> => {
  pipedLines ??= createInterface({ input: stdin })[Symbol.asyncIterator]();
  stdout.write(question);
  const line = await pipedLines.next();
  stdout.write('\n');
  if (line.done) throw new Error('Input ended before all answers were given');
  return line.value;
};

export const ask = async (question: string): Promise<string> => {
  if (!stdin.isTTY) return (await nextPipedLine(question)).trim();

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await new Promise<string>((resolve) => rl.question(question, resolve))).trim();
  } finally {
    rl.close();
  }
};

/** Like `ask`, but shows `*` instead of the typed characters. */
export const askHidden = (question: string): Promise<string> => {
  if (!stdin.isTTY) return nextPipedLine(question);

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish();
        if (char === CTRL_C) return finish(new Error('Cancelled'));
        if (BACKSPACE.has(char)) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        if (char < ' ') continue;
        value += char;
        stdout.write('*');
      }
    };

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
};
