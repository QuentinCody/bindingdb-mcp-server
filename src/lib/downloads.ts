import { bindingdbFailure, fetchDownloadText } from "./download-read";

export { readText } from "./download-read";

/** Adapter-owned public download discovery; dated filenames alone are not immutable releases. */
export const DOWNLOAD_PAGE = "https://www.bindingdb.org/rwd/bind/chemsearch/marvin/Download.jsp";
export const ARCHIVE_COLLECTION = "https://library.ucsd.edu/dc/collection/bb03870458";
const ROOT = "https://www.bindingdb.org";
const DOWNLOAD_PATH = "/rwd/bind/downloads/";
const FILE = /^BindingDB_([A-Za-z][A-Za-z0-9_-]*?)_(\d{4}(?:0[1-9]|1[0-2]))_tsv\.zip$/;

function failure(message: string, status = 400): never {
  throw bindingdbFailure(message, status);
}
export async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
function decodeHtml(text: string): string {
  return text.replace(/&amp;/gi, "&").replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (match, hex, dec) => {
    const code = Number.parseInt(hex ?? dec, hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }).replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
}
function sameHost(url: URL): boolean {
  return url.origin === ROOT && !url.username && !url.password && !url.hash;
}
export function parseDownloads(html: string) {
  const links = new Map<string, { url: string; landing_url: string }>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi)) {
    let url: URL;
    try { url = new URL(decodeHtml(match[1] ?? match[2]), DOWNLOAD_PAGE); }
    catch { continue; }
    if (!sameHost(url)) continue;
    const landing = url.href;
    if (url.pathname === "/rwd/bind/chemsearch/marvin/SDFdownload.jsp") {
      const files = url.searchParams.getAll("download_file");
      if (files.length !== 1) continue;
      try { url = new URL(files[0], ROOT); } catch { continue; }
    }
    if (!sameHost(url) || url.search || !url.pathname.startsWith(DOWNLOAD_PATH)) continue;
    const filename = url.pathname.slice(DOWNLOAD_PATH.length);
    if (filename.includes("/") || filename.includes("%")) continue;
    links.set(filename, { url: url.href, landing_url: landing });
  }
  const files = [];
  for (const [filename, link] of links) {
    const match = FILE.exec(filename);
    if (!match) continue;
    const checksum = links.get(filename.replace(/\.zip$/, ".md5"));
    files.push({ filename, subset: match[1], release_label: match[2], ...link, checksum_url: checksum?.url ?? null });
  }
  if (!files.length) failure("No dated TSV archives found on the current BindingDB download page; refusing a fabricated release", 502);
  return files.sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function downloads(path: string, params: Record<string, unknown>) {
  if (path !== "/bulk/releases" && path !== "/bulk/manifest") failure("Unknown BindingDB bulk operation", 404);
  const manifest = path === "/bulk/manifest";
  const allowed = new Set(manifest ? ["filename", "expected_md5", "include_assays"] : []);
  for (const key of Object.keys(params)) if (!allowed.has(key)) failure(`Unsupported bulk parameter: ${key}`);
  if (manifest && (typeof params.filename !== "string" || !FILE.test(params.filename))) failure("filename must be an exact dated TSV archive from /bulk/releases");
  if (params.expected_md5 !== undefined && (typeof params.expected_md5 !== "string" || !/^[a-f0-9]{32}$/i.test(params.expected_md5))) failure("expected_md5 must contain 32 hexadecimal characters");
  if (params.include_assays !== undefined && typeof params.include_assays !== "boolean") failure("include_assays must be a boolean");
  const deadline = Date.now() + 30_000;
  const get = (url: string, bytes: number) => fetchDownloadText(url, bytes, deadline);
  const html = await get(DOWNLOAD_PAGE, 1024 * 1024);
  const files = parseDownloads(html);
  const provenance = {
    source_url: DOWNLOAD_PAGE, retrieved_at: new Date().toISOString(), listing_sha256: await sha256(html),
    archive_collection: ARCHIVE_COLLECTION,
    release_note: "Filename labels identify monthly downloads; they do not prove immutability or a measurement's publication/curation date. BindingDB recommends its separate quarterly UCSD archive for reproducible training. Archive holdings are not fetched here.",
  };
  if (!manifest) return { files, _bindingdb: provenance };
  const { selected, file } = selectDownloadFiles(files, params);
  const manifests = [];
  for (const selectedFile of selected) {
    manifests.push(await checksumManifest(selectedFile, get, selectedFile === file ? params.expected_md5 : undefined));
  }
  return {
    files: manifests,
    _bindingdb: provenance,
    assay_join: params.include_assays ? {
      source_url: DOWNLOAD_PAGE,
      measurement_filename: file.filename,
      reaction_mapping_filename: selected[1].filename,
      assay_description_filename: selected[2].filename,
      steps: ["Measurement Reaction Set ID → Entry ID + Assay ID via rsid_eaids", "Entry ID + Assay ID → assay description via Assays"],
      note: "Provider-documented join, not an executed join or validation of TSV headers/cardinality. Matching month labels do not establish a transactionally consistent snapshot; retain and verify all artifact bytes.",
    } : undefined,
    temporal_manifest: {
      builder: "servers/bindingdb-mcp-server/scripts/measurement_manifest.py",
      required: "Download and retain the exact artifact, verify its checksum scope, and pin its SHA-256. Inspect actual TSV headers and explicitly select publication and curation column indexes; the 2025 TSV PDF repeats a date label. Preserve missing/partial dates and row qualifiers.",
      limitations: "This is a download manifest, not measurement data. REST output is not assumed to include bulk date columns. Run the offline builder to produce a checksum-pinned, complete measurement manifest; no full archive is fetched inside the Worker.",
    },
  };
}

function selectDownloadFiles(files: { checksum_url: string | null; url: string; landing_url: string; filename: string; subset: string; release_label: string; }[], params: Record<string, unknown>) {
  const file = files.find(item => item.filename === params.filename);
  if (!file) failure("Requested release file is not currently advertised; no fallback to a different release", 404);
  const selected = [file];
  if (params.include_assays) {
    if (file.subset === "Assays" || file.subset === "rsid_eaids") failure("include_assays requires a measurement archive filename");
    for (const subset of ["rsid_eaids", "Assays"]) {
      const companion = files.find(item => item.subset === subset && item.release_label === file.release_label);
      if (!companion) failure(`No advertised ${subset} companion for release ${file.release_label}; no cross-release fallback`, 404);
      selected.push(companion);
    }
  }
  if (selected.some(item => !item.checksum_url)) failure("Requested release has no advertised checksum link", 502);
  return { selected, file };
}

async function checksumManifest(file: ReturnType<typeof parseDownloads>[number], get: (url: string, bytes: number) => Promise<string>, expected: unknown) {
  if (!file.checksum_url) failure("Requested release has no advertised checksum link", 502);
  const checksumText = (await get(file.checksum_url, 4096)).trim();
  const checksum = /^([a-f0-9]{32})(?:\s+\*?([^\r\n]+))?$/i.exec(checksumText);
  if (!checksum || (checksum[2] && checksum[2] !== file.filename)) failure("Invalid or ambiguous BindingDB MD5 sidecar", 502);
  const md5 = checksum[1].toLowerCase();
  if (expected !== undefined && md5 !== String(expected).toLowerCase()) failure("BindingDB checksum changed from expected_md5", 409);
  return {
    ...file,
    provider_checksum: { algorithm: "MD5", value: md5, scope: checksum[2] ? "archive named by sidecar" : "not specified by bare digest; verify against the downloaded archive or member" },
    artifact_bytes_verified: false,
  };
}
