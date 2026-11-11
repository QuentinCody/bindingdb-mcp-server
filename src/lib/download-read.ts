export function bindingdbFailure(message: string, status: number, data?: unknown): Error & { status: number; data?: unknown } {
  const error = new Error(message) as Error & { status: number; data?: unknown };
  error.status = status;
  error.data = data ?? { adapter: "bindingdb", status, message };
  return error;
}
function timeout(): Error {
  return bindingdbFailure("BindingDB request exceeded its deadline", 504);
}

async function beforeDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const remaining = deadlineAt - Date.now();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(timeout()), Math.max(0, remaining));
    });
    return await Promise.race([operation, deadline]);
  } finally { clearTimeout(timer); }
}

/** Byte-bounded UTF-8 with an absolute deadline, including streamed bodies. */
export async function readText(response: Response, maxBytes: number, deadlineAt = Date.now() + 30_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw bindingdbFailure("BindingDB returned no body", 502);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      if (Date.now() >= deadlineAt) throw timeout();
      const { done, value } = await beforeDeadline(reader.read(), deadlineAt);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw bindingdbFailure("BindingDB response exceeds the operation's byte limit", 502);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (!response.ok || response.status === 206 || response.headers.has("content-range")) {
      throw bindingdbFailure(`BindingDB HTTP ${response.status}${response.ok ? ": incomplete response" : ""}`, response.ok ? 502 : response.status,
        { response: text, upstream_status: response.status, content_type: response.headers.get("content-type"), content_range: response.headers.get("content-range") });
    }
    return text;
  } catch (error) {
    if (error instanceof TypeError) throw bindingdbFailure("BindingDB returned unreadable or invalid UTF-8 data", 502);
    throw error;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function fetchDownloadText(url: string, maxBytes: number, deadlineAt: number): Promise<string> {
  if (Date.now() >= deadlineAt) throw timeout();
  const controller = new AbortController();
  try {
    const request = fetch(url, { redirect: "manual", headers: { Accept: "text/html,text/plain" }, signal: controller.signal }).then(response => {
      if (controller.signal.aborted || Date.now() >= deadlineAt) {
        void response.body?.cancel().catch(() => undefined);
        throw timeout();
      }
      return response;
    });
    const response = await beforeDeadline(request, deadlineAt);
    return await readText(response, maxBytes, deadlineAt);
  } finally { controller.abort(); }
}
