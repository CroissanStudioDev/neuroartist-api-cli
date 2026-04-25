export interface SseFrame {
  data: string;
  event?: string;
}

const LEADING_SPACE_RE = /^ /;

/**
 * Parse a Server-Sent Events stream into discrete frames.
 *
 * Implements just enough of the SSE protocol for our gateway's
 * progress channel: `event:` and `data:` lines, frame boundary on
 * blank line. `id:` and `retry:` are ignored.
 */
export async function* parseSse(res: Response): AsyncGenerator<SseFrame> {
  if (!res.body) {
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawFrame = buffer.slice(0, boundary).replace(/\r/g, "");
        buffer = buffer.slice(boundary + 2);
        const frame = parseFrame(rawFrame);
        if (frame) {
          yield frame;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    // Tail (no trailing blank line — emit if it has data).
    const tail = buffer.replace(/\r/g, "").trim();
    if (tail) {
      const frame = parseFrame(tail);
      if (frame) {
        yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(LEADING_SPACE_RE, ""));
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return { event, data: dataLines.join("\n") };
}
