import type { ApiEndpoint, WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";

export const downloadEndpoints: ApiEndpoint[] = [
  {
    method: "GET", path: "/bulk/releases", category: "bulk", featured: true,
    summary: "Adapter-owned discovery of dated TSV measurement and assay-mapping archives advertised on BindingDB's current download page.",
    description: "Lists exact source filenames, monthly labels, landing/file URLs and advertised checksum links. No fallback to the stale SDFdownload all-files page. Source-page hash and retrieval time are retained. Dated filenames are not immutable snapshots. The official quarterly UCSD archive is recommended for archival model training; its holdings are not fetched here.",
  },
  {
    method: "GET", path: "/bulk/manifest", category: "bulk", featured: true,
    summary: "Adapter-owned download manifest with observed provider MD5 and optional checksum-drift guard; no large archive download.",
    description: "Requires a filename currently advertised by /bulk/releases. Optional include_assays adds the advertised rsid_eaids and Assays archives with exactly the same month label, their individual sidecar digests and the provider's join guidance. Fails if either companion or checksum is absent; never substitutes another month. Retains exact source and checksum URLs. Bare MD5 sidecars do not identify whether the digest covers ZIP or uncompressed bytes; scope must be verified. artifact_bytes_verified=false until artifact bytes are checked. No REST measurement-date columns are assumed.",
    queryParams: [
      { name: "filename", type: "string", required: true, description: "Exact dated TSV ZIP filename from /bulk/releases" },
      { name: "expected_md5", type: "string", required: false, description: "32-hex digest previously observed for the selected measurement filename; rejects drift (does not guard companion digests)" },
      { name: "include_assays", type: "boolean", required: false, description: "Include same-month reaction/assay mapping and assay descriptions in a measurement manifest; defaults to false" },
    ],
  },
];
export const downloadWorkflows: WorkflowRecipe[] = [
  {
    title: "Discover dated BindingDB measurements for temporal validation",
    description: "Discover exact current TSV and assay-mapping releases first. For a selected filename call /bulk/manifest, retain its digest, then download and process offline with scripts/measurement_manifest.py. The builder requires an exact artifact SHA-256 and explicit publication/curation column indexes. Do not equate monthly labels, HTTP modification times or REST retrieval dates with measurement dates.",
    keywords: ["release", "manifest", "publication", "curation", "temporal", "training", "TSV"],
    code: 'return await api.get("/bulk/releases");',
  },
  {
    title: "Discover a BindingDB measurement and assay-description manifest",
    description: "Discover the advertised All measurement archive, then request its exact same-month assay companions and individual MD5 sidecars. Return errors or staged handles intact. Review and retain the manifest before downloading artifacts outside the Worker; this does not execute the assay join or establish snapshot consistency.",
    keywords: ["assay", "description", "join", "reaction", "manifest", "release"],
    code: `const listing = await api.get("/bulk/releases");
if (listing.__api_error || listing.__staged || listing.__stage_error) return listing;
const measurements = listing.files.filter(file => file.subset === "All");
if (measurements.length !== 1) return { error: "Select an exact measurement filename from the listing", listing };
return await api.get("/bulk/manifest", { filename: measurements[0].filename, include_assays: true });`,
  },
];
