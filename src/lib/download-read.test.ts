import { afterEach, expect, it, vi } from "vitest";
import { fetchDownloadText, readText } from "./download-read";
import { downloads } from "./downloads";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("preserves BOM and split UTF-8 characters for source-page hashing", async () => {
  const bytes = new TextEncoder().encode("\ufeffα\r\n");
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  expect(await readText(new Response(stream), bytes.length)).toBe("\ufeffα\r\n");
});

it("rejects invalid UTF-8 instead of hashing replacement characters", async () => {
  await expect(readText(new Response(Uint8Array.of(0xff)), 10)).rejects.toMatchObject({ status: 502 });
});

it.each([206, 200])("rejects partial response evidence at HTTP %i", async status => {
  const response = "partial α".repeat(500);
  await expect(readText(new Response(response, { status, headers: { "content-range": "bytes 0-4999/10000" } }), 10000))
    .rejects.toMatchObject({ status: 502, data: { response, upstream_status: status, content_range: "bytes 0-4999/10000" } });
});

it("times out a stalled body even when cancellation never resolves", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const promise = readText(new Response(new ReadableStream({ pull() {}, cancel })), 1024, Date.now() + 100);
  const assertion = expect(promise).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(100);
  await assertion;
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("times out stalled headers and cancels a response that arrives late", async () => {
  vi.useFakeTimers();
  let resolve!: (value: Response) => void;
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal("fetch", fetch);
  const assertion = expect(fetchDownloadText("https://www.bindingdb.org/fixture", 1024, Date.now() + 100)).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(100);
  await assertion;
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  const cancel = vi.fn();
  resolve(new Response(new ReadableStream({ cancel })));
  await vi.advanceTimersByTimeAsync(0);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("uses one deadline for listing and all selected checksum sidecars", async () => {
  vi.useFakeTimers();
  const files = ["All", "rsid_eaids", "Assays"].map(subset => `BindingDB_${subset}_202610_tsv`);
  const html = files.map(file => `<a href="/rwd/bind/downloads/${file}.zip">zip</a><a href="/rwd/bind/downloads/${file}.md5">md5</a>`).join("");
  let started!: () => void;
  const firstSidecar = new Promise<void>(resolve => { started = resolve; });
  const fetch = vi.fn().mockImplementation(() => {
    started();
    return new Promise<Response>(resolve => setTimeout(() => resolve(new Response("a".repeat(32))), 11_000));
  });
  fetch.mockResolvedValueOnce(new Response(html));
  vi.stubGlobal("fetch", fetch);
  const assertion = expect(downloads("/bulk/manifest", { filename: `${files[0]}.zip`, include_assays: true })).rejects.toMatchObject({ status: 504 });
  await firstSidecar;
  await vi.advanceTimersByTimeAsync(30_000);
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(4);
});
