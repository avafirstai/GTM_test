/**
 * Shared SSE parser — extracts events from a chunked SSE buffer.
 *
 * Usage:
 *   buffer = parseSSEEvents(buffer, (event, data) => { ... });
 *
 * Returns the unparsed remainder (incomplete event awaiting more data).
 */
export function parseSSEEvents(
  buffer: string,
  onEvent: (event: string, data: string) => void,
): string {
  const parts = buffer.split("\n\n");
  const remaining = parts.pop() || "";

  for (const block of parts) {
    if (!block.trim()) continue;

    let eventType = "";
    let eventData = "";

    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) eventType = line.slice(7).trim();
      else if (line.startsWith("data: ")) eventData = line.slice(6);
    }

    if (eventType && eventData) {
      onEvent(eventType, eventData);
    }
  }

  return remaining;
}
