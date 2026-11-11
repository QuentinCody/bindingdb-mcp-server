import { afterEach, expect, it, vi } from "vitest";
import { createBindingdbApiFetch } from "./api-adapter";
import { ARCHIVE_COLLECTION, DOWNLOAD_PAGE, downloads, parseDownloads, readText } from "./downloads";

const filename = "BindingDB_All_202609_tsv.zip";
const digest = "19db177dc630e556bd1449db408767ca";
const html = `<html><a href="SDFdownload.jsp?download_file=%2Frwd%2Fbind%2Fdownloads%2F${filename}">${filename}</a>
<a href="/rwd/bind/downloads/BindingDB_All_202609_tsv.md5">md5</a>
<a href='/rwd/bind/downloads/BindingDB_Assays_202609_tsv.zip'>assays</a>
<a href='/rwd/bind/downloads/BindingDB_rsid_eaids_202609_tsv.zip'>reaction/assay mapping</a>
<a href='/rwd/bind/downloads/BindingDB_All_202609.tsv.zip'>stale link</a></html>`;
const response = (text: string, code = 200) => new Response(text, { status: code });
afterEach(() => vi.unstubAllGlobals());

it("discovers exact advertised files, assay mappings and checksum links without fabricating archives", () => {
  const files = parseDownloads(html);
  expect(files).toHaveLength(3);
  expect(files[0]).toMatchObject({ filename, release_label: "202609", subset: "All", checksum_url: "https://www.bindingdb.org/rwd/bind/downloads/BindingDB_All_202609_tsv.md5" });
  expect(files[1].checksum_url).toBeNull();
  expect(files[2].subset).toBe("rsid_eaids");
});
it.each([
  `<a href="https://evil.example/rwd/bind/downloads/${filename}">asset</a>`,
  `<a href="SDFdownload.jsp?download_file=https%3A%2F%2Fevil.example%2F${filename}">asset</a>`,
  `<a href="/rwd/bind/downloads/BindingDB_All_202609.tsv.zip">zero-byte legacy placeholder</a>`,
  `<a href="/rwd/bind/downloads/BindingDB_All_202613_tsv.zip">invalid month</a>`,
  `<a href="/rwd/bind/downloads/${filename}?redirect=elsewhere">query</a>`,
  "<html>Login required</html>",
])("refuses fabricated, unsupported or off-host download metadata %#", html => {
  expect(() => parseDownloads(html)).toThrow();
});
it("returns listing provenance and archive guidance without treating a monthly label as immutable", async () => {
  const fetch = vi.fn().mockResolvedValue(response(html)); vi.stubGlobal("fetch", fetch);
  const result = await downloads("/bulk/releases", {});
  expect(result).toMatchObject({ files: expect.any(Array), _bindingdb: { source_url: DOWNLOAD_PAGE, archive_collection: ARCHIVE_COLLECTION, listing_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].redirect).toBe("manual");
});
it("records an observed checksum without claiming artifact verification or a guessed digest scope", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(`${digest}\n`)); vi.stubGlobal("fetch", fetch);
  const result = await createBindingdbApiFetch()({ method: "GET", path: "/bulk/manifest", params: { filename, expected_md5: digest.toUpperCase() } });
  expect(result).toMatchObject({ data: { files: [{ filename, provider_checksum: { algorithm: "MD5", value: digest, scope: expect.stringContaining("not specified") }, artifact_bytes_verified: false }] } });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([url]) => !String(url).endsWith(".zip"))).toBe(true);
});
it("accepts a checksum sidecar that explicitly names its archive", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(`${digest} *${filename}`)));
  const result = await downloads("/bulk/manifest", { filename });
  expect(result.files[0]).toMatchObject({ provider_checksum: { scope: "archive named by sidecar" } });
});
it("rejects changed checksums", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(digest)));
  await expect(downloads("/bulk/manifest", { filename, expected_md5: "0".repeat(32) })).rejects.toMatchObject({ status: 409 });
});
it.each(["<html>404</html>", `${digest}\n${digest}`, `${digest} other.zip`, "abcd"]) ("rejects malformed or ambiguous sidecars %#", async md5 => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(html)).mockResolvedValueOnce(response(md5)));
  await expect(downloads("/bulk/manifest", { filename })).rejects.toMatchObject({ status: 502 });
});
it("does not fall back when an exact release is absent", async () => {
  const fetch = vi.fn().mockResolvedValue(response(html)); vi.stubGlobal("fetch", fetch);
  await expect(downloads("/bulk/manifest", { filename: "BindingDB_All_202608_tsv.zip" })).rejects.toMatchObject({ status: 404 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("requires an advertised checksum link", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(html)));
  await expect(downloads("/bulk/manifest", { filename: "BindingDB_Assays_202609_tsv.zip" })).rejects.toMatchObject({ status: 502 });
});
it.each([{ filename: "../../x" }, { filename, expected_md5: "bad" }, { filename, release: "latest" }])("rejects invalid manifest selectors before fetching %#", async params => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(downloads("/bulk/manifest", params)).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});
it("bounds UTF8 reads and HTTP errors", async () => {
  await expect(readText(response("α".repeat(100)), 100)).rejects.toMatchObject({ status: 502 });
  await expect(readText(response("upstream unavailable", 503), 1024)).rejects.toMatchObject({ status: 503, data: { response: "upstream unavailable" } });
});
it("retains any upstream measurement dates and qualifiers without claiming undocumented fields", async () => {
  const raw = { getLigandsByUniprotsResponse: { affinities: [{ monomerid: "1", affinity: ">1000", publication_date: "2020", curation_date: "", source: "fixture" }] } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(raw), { headers: { "content-type": "application/json" } })));
  expect(await createBindingdbApiFetch()({ method: "GET", path: "/getLigandsByUniprots", params: { uniprot: "P00533" } })).toEqual({ status: 200, data: raw });
});
it("surfaces malformed JSON with a JSON content-type as an upstream error, not text data", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Service Unavailable</html>", { headers: { "content-type": "application/json" } })));
  await expect(createBindingdbApiFetch()({ method: "GET", path: "/getLigandsByUniprots", params: { uniprot: "P00533" } })).rejects.toMatchObject({ status: 502, data: { upstream_status: 200, content_type: "application/json", response: "<html>Service Unavailable</html>" } });
});
it("preserves documented empty REST responses and XML compatibility", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response("")).mockResolvedValueOnce(response("<affinities/>")));
  const api = createBindingdbApiFetch();
  expect(await api({ method: "GET", path: "/rest/getLigandsByUniprots" })).toMatchObject({ data: {} });
  expect(await api({ method: "GET", path: "/rest/getLigandsByUniprots" })).toMatchObject({ data: "<affinities/>" });
});
it("does not silently convert unsupported methods to GET", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(createBindingdbApiFetch()({ method: "POST", path: "/bulk/manifest" })).rejects.toMatchObject({ status: 405 });
  expect(fetch).not.toHaveBeenCalled();
});
