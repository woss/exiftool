import { assertEquals } from '../../deps.ts';
import { readLines, stayOpenLoop } from './stay-open.ts';

function feed(...lines: string[]): AsyncIterable<string> {
  return (async function* () {
    for (const l of lines) yield l;
  })();
}

Deno.test('stayOpenLoop executes each -execute batch and emits ready', async () => {
  const calls: string[][] = [];
  const emitted: string[] = [];
  const result = await stayOpenLoop(
    feed('-Make', 'X', '-execute', '-Model', 'Y', '-execute'),
    async (args) => {
      calls.push(args);
      return 0;
    },
    (t) => emitted.push(t),
  );
  assertEquals(result.batches, 2);
  assertEquals(result.shutdownRequested, false);
  assertEquals(calls, [['-Make', 'X'], ['-Model', 'Y']]);
  assertEquals(emitted, ['{ready}', '{ready}']);
});

Deno.test('stayOpenLoop shuts down on -stay_open False pair', async () => {
  const calls: string[][] = [];
  const result = await stayOpenLoop(
    feed('-stay_open', 'True', '-Make', 'A', '-execute', '-stay_open', 'False', '-Never', 'ran'),
    async (args) => {
      calls.push(args);
      return 0;
    },
    () => {},
  );
  assertEquals(result.shutdownRequested, true);
  assertEquals(calls.length, 1);
});

Deno.test('stayOpenLoop True decision line keeps the daemon running', async () => {
  const result = await stayOpenLoop(
    feed('-stay_open', 'True', '-q', '-execute'),
    async () => 0,
    () => {},
  );
  assertEquals(result.batches, 1);
  assertEquals(result.shutdownRequested, false);
});

Deno.test('stayOpenLoop ends at end of input without shutdown request', async () => {
  const result = await stayOpenLoop(feed('-j'), async () => 0, () => {});
  assertEquals(result.batches, 0);
  assertEquals(result.shutdownRequested, false);
});

Deno.test('readLines splits a chunked byte stream into lines', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode('a\nbb'));
      controller.enqueue(enc.encode('\nccc\n'));
      controller.close();
    },
  });
  const out: string[] = [];
  for await (const line of readLines(stream)) out.push(line);
  assertEquals(out, ['a', 'bb', 'ccc']);
});

Deno.test('readLines feeds CRLF-terminated commands through the loop trim', async () => {
  const calls: string[][] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode('-Make=X\r\n-execute\r\n'));
      controller.close();
    },
  });
  const result = await stayOpenLoop(readLines(stream), async (args) => {
    calls.push(args);
    return 0;
  }, () => {});
  assertEquals(result.batches, 1);
  assertEquals(calls, [['-Make=X']]);
});

Deno.test('readLines emits a final line without a trailing newline', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('a\nb'));
      controller.close();
    },
  });
  const out: string[] = [];
  for await (const line of readLines(stream)) out.push(line);
  assertEquals(out, ['a', 'b']);
});
