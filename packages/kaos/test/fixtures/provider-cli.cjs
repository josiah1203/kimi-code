const mode = process.env.SPIDERBYTE_FIXTURE_MODE
  ?? (process.env.PROVIDER_AUTH === 'super-secret' ? 'secret-output' : 'normal');
const command = process.argv[2];

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  if (command === 'version') {
    process.stdout.write('fixture-provider 1.2.3\n');
    return;
  }

  if (command === 'models') {
    process.stdout.write(
      JSON.stringify({
        models: [
          { id: 'fixture-small', displayName: 'Fixture Small', capabilities: ['chat'] },
          { id: 'fixture-large', contextWindow: 128000, capabilities: ['chat', 'tools'] },
        ],
      }) + '\n',
    );
    return;
  }

  if (command !== 'run') {
    fail('unsupported command', 2);
    return;
  }

  if (mode === 'hang') {
    await new Promise(() => {});
    return;
  }

  if (mode === 'malformed') {
    process.stdout.write('terminal decoration: hello\n');
    return;
  }

  if (mode === 'large-output') {
    process.stdout.write(JSON.stringify({ type: 'text', text: 'x'.repeat(256) }) + '\n');
    return;
  }

  if (mode === 'auth-failure') {
    fail('authentication failed token=super-secret', 9);
    return;
  }

  const input = JSON.parse(await readStdin());
  if (mode === 'secret-output') {
    const token = process.env.PROVIDER_TOKEN ?? process.env.PROVIDER_AUTH ?? 'missing-token';
    for (const event of [
      { type: 'text', text: `provider output token=${token}` },
      { type: 'metadata', metadata: { diagnostic: `token=${token}` } },
      { type: 'done' },
    ]) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    }
    return;
  }

  const events = [
    { type: 'text', text: `hello ${input.model ?? 'default'}: ${input.prompt}` },
    { type: 'usage', usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } },
    { type: 'done' },
  ];
  for (const event of events) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    if (mode === 'stream') await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

void main().catch((error) => fail(error instanceof Error ? error.message : String(error), 1));
