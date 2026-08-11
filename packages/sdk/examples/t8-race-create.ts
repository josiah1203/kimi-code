// T8.4 driver: create session with explicit id, twice concurrently in same process.
import { createSpiderByteHarness, type SpiderByteHarness } from '@spiderbyte/sdk';

const workDir = process.argv[2]!;
const homeDir = process.argv[3]!;
const sessionId = process.argv[4]!;

const identity: any = { productName: 'spiderbyte-cli', version: '0.0.1-test', platform: 'spiderbyte_cli' };
const harnessA = createSpiderByteHarness({ identity, homeDir });
const harnessB = createSpiderByteHarness({ identity, homeDir });

async function run(label: string, h: SpiderByteHarness): Promise<void> {
  try {
    const s = await h.createSession({ workDir, id: sessionId, model: 'local/example-model' });
    console.log(JSON.stringify({ label, ok: true, id: s.id, dir: s.summary?.sessionDir }));
  } catch (error: any) {
    console.log(JSON.stringify({ label, ok: false, msg: String(error.message ?? error), code: error.code ?? error.cause?.code }));
  } finally {
    await h.close();
  }
}

await Promise.all([run('A', harnessA), run('B', harnessB)]);
