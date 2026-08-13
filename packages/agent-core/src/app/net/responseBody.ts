/** Shared app-level bounded HTTP response-body reader. */

export async function readResponseTextBounded(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        chunks.push(decoder.decode());
        return chunks.join('');
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}
