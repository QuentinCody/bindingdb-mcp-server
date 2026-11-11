import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";
import { downloadEndpoints, downloadWorkflows } from "./downloads";
import { compoundHandoffWorkflow } from "./compound-handoff";

/**
 * BindingDB REST API catalog.
 * Default output is XML; the adapter always injects `response=application/json`.
 * Empty-result queries may return an empty body, which the adapter maps to `{}`.
 */
export const bindingdbCatalog: ApiCatalog = {
    name: "BindingDB",
    baseUrl: "https://bindingdb.org",
    version: "v1",
    auth: "none",
    endpointCount: 4 + downloadEndpoints.length,
    workflows: [...downloadWorkflows, compoundHandoffWorkflow],
    notes:
        "- Publication/curation dates are advertised for bulk/search results, not guaranteed in REST. Use /bulk/releases and /bulk/manifest for dated assets.\n" +
        "- The adapter injects `response=application/json` automatically; XML is the upstream default.\n" +
        "- Empty-result queries may return an empty body (200 OK, no text) — the adapter maps this to `{}`.\n" +
        "- These REST services do not document generic limit/offset pagination; do not assume an arbitrary client cap is supported.\n" +
        "- `cutoff` on PDB-based endpoints is an affinity cap in nM (e.g. 100 nM); `identity` is a percent sequence-identity cutoff.\n" +
        "- `cutoff` on getTargetByCompound is a similarity coefficient (0.0–1.0, e.g. 0.85).\n" +
        "- getLigandsBySmiles, getTargetsByCompound, getLigandsByPDB and getLigandsByTarget returned 404 in native acceptance on 2026-10-04 and are excluded from discovery.\n" +
        "- Some paths use plural forms (`PDBs`, `Uniprots`) — stick to the casings in this catalog.",
    endpoints: [
        ...downloadEndpoints,
        {
            method: "GET",
            path: "/rest/getLigandsByPDBs",
            summary: "Find ligands + affinities for one or more PDB structures.",
            category: "ligands",
            queryParams: [
                { name: "pdb", type: "string", required: true, description: "Comma-separated PDB identifier(s), e.g. '1Q0L' or '1Q0L,1E0Y'." },
                { name: "cutoff", type: "number", required: false, description: "Affinity cap in nM (e.g. 100)." },
                { name: "identity", type: "number", required: false, description: "Sequence identity cutoff percent (e.g. 92)." },
                { name: "response", type: "string", required: false, description: "Output format: application/json (adapter default) or application/xml." },
            ],
        },
        {
            method: "GET",
            path: "/rest/getLigandsByUniprots",
            summary: "Find ligands + affinities for one or more UniProt targets.",
            category: "ligands",
            queryParams: [
                { name: "uniprot", type: "string", required: true, description: "Comma-separated UniProt accession(s), e.g. 'P00533'." },
                { name: "cutoff", type: "number", required: false, description: "Affinity cap in nM." },
                { name: "response", type: "string", required: false, description: "Output format: application/json (adapter default) or application/xml." },
            ],
        },
        {
            method: "GET",
            path: "/rest/getLigandsByUniprot",
            summary: "Legacy singular UniProt form; prefer /rest/getLigandsByUniprots.",
            usageHint: "Encode accession and cutoff together as uniprot=P35355;100, as in the provider example. JSON output was verified for that request. Prefer the plural route for separate cutoff parameters.",
            category: "ligands",
            queryParams: [
                { name: "uniprot", type: "string", required: true, description: "Accession with optional semicolon-delimited affinity cutoff, e.g. P35355;100." },
                { name: "response", type: "string", required: false, description: "Output format: application/json (adapter default) or application/xml." },
            ],
        },
        {
            method: "GET",
            path: "/rest/getTargetByCompound",
            summary: "Find targets and affinities for compounds similar to the supplied SMILES (documented singular REST form).",
            category: "targets",
            queryParams: [
                { name: "smiles", type: "string", required: true, description: "Query SMILES; matches may be similar compounds, not exact identity." },
                { name: "cutoff", type: "number", required: false, description: "Structure similarity coefficient (0–1, e.g. 0.85), not an affinity cap." },
                { name: "response", type: "string", required: false, description: "Output format: application/json (adapter default) or application/xml." },
            ],
        },
        // NOTE: /rest/getTrgSDFs was removed from the catalog on 2026-04-17 —
        // upstream returned HTTP 404 across all test accessions (target names
        // and UniProt IDs). Keep it out until BindingDB restores the endpoint.
    ],
};
