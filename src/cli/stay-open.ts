export interface StayOpenResult {
  /** Number of `-execute` batches that were processed. */
  batches: number;
  /** Whether the loop ended because the client requested shutdown. */
  shutdownRequested: boolean;
}

/**
 * ExifTool-compatible `-stay_open` command loop.
 *
 * Reads one argument per line. A line of `-execute` runs the accumulated
 * arguments through `exec`, then emits `{ready}` via `emit`, exactly like
 * ExifTool. The pair of lines `-stay_open` / `False` terminates the loop;
 * end of input also terminates it.
 */
export async function stayOpenLoop(
  lines: Iterable<string> | AsyncIterable<string>,
  exec: (args: string[]) => Promise<number>,
  emit: (text: string) => void,
): Promise<StayOpenResult> {
  const pending: string[] = [];
  let batches = 0;
  let awaitingShutdownDecision = false;
  let shutdownRequested = false;

  for await (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (awaitingShutdownDecision) {
      awaitingShutdownDecision = false;
      if (/^false$/i.test(line)) {
        shutdownRequested = true;
        break;
      }
      continue; // 'True' keeps the daemon running and is not an argument
    }
    if (line === '-stay_open') {
      awaitingShutdownDecision = true;
      continue;
    }
    if (line === '-execute') {
      await exec([...pending]);
      pending.length = 0;
      batches++;
      emit('{ready}');
      continue;
    }
    pending.push(line);
  }

  return { batches, shutdownRequested };
}

/** Splits a byte stream into newline-terminated lines. */
export async function* readLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 1);
    }
  }
  if (buf.length > 0) yield buf;
}
