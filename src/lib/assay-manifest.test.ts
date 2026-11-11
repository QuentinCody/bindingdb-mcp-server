import { afterEach, expect, it, vi } from "vitest";
import { downloads, parseDownloads } from "./downloads";

const measurement = "BindingDB_Covid-19_202610_tsv.zip";
const mapping = "BindingDB_rsid_eaids_202610_tsv.zip";
const assays = "BindingDB_Assays_202610_tsv.zip";
const digest = "a".repeat(32);
const link = (file: string) => `<a href="/rwd/bind/downloads/${file}">${file}</a>`;
const listing = (files = [measurement, mapping, assays]) => files.map(file => link(file) + link(file.replace(/\.zip$/, ".md5"))).join("\n");
const mock = (html = listing(), sidecars = [digest, "b".repeat(32), "c".repeat(32)]) => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(html));
  for (const sidecar of sidecars) fetch.mockResolvedValueOnce(new Response(sidecar));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};
afterEach(() => vi.unstubAllGlobals());

it("discovers the provider's hyphenated Covid-19 subset", () => {
  expect(parseDownloads(listing())).toContainEqual(expect.objectContaining({ filename: measurement, subset: "Covid-19", release_label: "202610" }));
});

it("returns three exact files with independent digests and documented join guidance", async () => {
  const fetch = mock();
  const result = await downloads("/bulk/manifest", { filename: measurement, include_assays: true, expected_md5: digest });
  expect(result.files.map(file => file.filename)).toEqual([measurement, mapping, assays]);
  expect(result).toMatchObject({
    files: [
      { provider_checksum: { value: digest }, artifact_bytes_verified: false },
      { provider_checksum: { value: "b".repeat(32) }, artifact_bytes_verified: false },
      { provider_checksum: { value: "c".repeat(32) }, artifact_bytes_verified: false },
    ],
    assay_join: { measurement_filename: measurement, reaction_mapping_filename: mapping, assay_description_filename: assays },
  });
  expect(fetch.mock.calls.map(([url]) => String(url)).slice(1)).toEqual([measurement, mapping, assays].map(file => `https://www.bindingdb.org/rwd/bind/downloads/${file.replace(/\.zip$/, ".md5")}`));
});

it("keeps the default manifest limited to the selected file", async () => {
  const fetch = mock();
  const result = await downloads("/bulk/manifest", { filename: measurement, include_assays: false });
  expect(result.files).toHaveLength(1);
  expect(result).not.toHaveProperty("assay_join", expect.any(Object));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([[], [mapping.replace("202610", "202609"), assays], [mapping]].map(companions => ({ companions })))("rejects missing or differently dated companions before reading any sidecar %#", async ({ companions }) => {
  const fetch = mock(listing([measurement, ...companions]));
  await expect(downloads("/bulk/manifest", { filename: measurement, include_assays: true })).rejects.toMatchObject({ status: 404 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not return a partial manifest when a companion sidecar is invalid", async () => {
  mock(listing(), [digest, "b".repeat(32), "c".repeat(31)]);
  await expect(downloads("/bulk/manifest", { filename: measurement, include_assays: true })).rejects.toMatchObject({ status: 502 });
});

it("requires checksum links for every companion", async () => {
  const fetch = mock(listing().replace(link(assays.replace(/\.zip$/, ".md5")), ""));
  await expect(downloads("/bulk/manifest", { filename: measurement, include_assays: true })).rejects.toMatchObject({ status: 502 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("rejects a companion as the measurement archive", async () => {
  mock();
  await expect(downloads("/bulk/manifest", { filename: assays, include_assays: true })).rejects.toMatchObject({ status: 400 });
});

it.each(["true", 1, null, {}])("rejects non-boolean include_assays before a fetch %#", async include_assays => {
  const fetch = mock();
  await expect(downloads("/bulk/manifest", { filename: measurement, include_assays })).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
});
