import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

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
    endpointCount: 9,
    notes:
        "- The adapter injects `response=application/json` automatically; XML is the upstream default.\n" +
        "- Empty-result queries may return an empty body (200 OK, no text) — the adapter maps this to `{}`.\n" +
        "- Similarity searches (getLigandsBySmiles) work best with small result caps; broader lookups tolerate ~10.\n" +
        "- `cutoff` on PDB-based endpoints is an affinity cap in nM (e.g. 100 nM); `identity` is a percent sequence-identity cutoff.\n" +
        "- `cutoff` on Smiles similarity is a Tanimoto coefficient (0.0–1.0, e.g. 0.85 / 0.9).\n" +
        "- Some paths use plural forms (`PDBs`, `Uniprots`) — stick to the casings in this catalog.",
    endpoints: [
        {
            method: "GET",
            path: "/rest/getLigandsByPDBs",
            summary: "Find ligands + affinities for one or more PDB structures.",
            category: "ligands",
            queryParams: [
                { name: "pdb", type: "string", required: true, description: "Comma-separated PDB identifier(s), e.g. '1Q0L' or '1Q0L,1E0Y'." },
                { name: "cutoff", type: "number", required: false, description: "Affinity cap in nM (e.g. 100)." },
                { name: "identity", type: "number", required: false, description: "Sequence identity cutoff percent (e.g. 92)." },
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
            ],
        },
        {
            method: "GET",
            path: "/rest/getLigandsByUniprot",
            summary: "Ligands for a single UniProt target (legacy singular form).",
            category: "ligands",
            queryParams: [
                { name: "uniprot", type: "string", required: true, description: "UniProt accession." },
                { name: "cutoff", type: "number", required: false, description: "Affinity cap in nM." },
            ],
        },
        {
            method: "GET",
            path: "/rest/getLigandsBySmiles",
            summary: "Similarity search: find ligands similar to a query SMILES string.",
            category: "similarity",
            queryParams: [
                { name: "smiles", type: "string", required: true, description: "Query SMILES string (e.g. 'CC(=O)OC1=CC=CC=C1C(=O)O' for aspirin)." },
                { name: "cutoff", type: "number", required: false, description: "Tanimoto similarity cutoff 0.0–1.0 (e.g. 0.85)." },
            ],
        },
        {
            method: "GET",
            path: "/rest/getTargetsByCompound",
            summary: "Find targets for a compound (by BindingDB monomer ID or SMILES).",
            category: "targets",
            queryParams: [
                { name: "monomerid", type: "string", required: false, description: "BindingDB monomer ID (e.g. '50000001')." },
                { name: "smiles", type: "string", required: false, description: "Query SMILES (alternative to monomerid)." },
                { name: "cutoff", type: "number", required: false, description: "Affinity cap in nM." },
            ],
        },
        {
            method: "GET",
            path: "/rest/getTargetByCompound",
            summary: "Legacy singular form of getTargetsByCompound.",
            category: "targets",
            queryParams: [
                { name: "monomerid", type: "string", required: false, description: "BindingDB monomer ID." },
                { name: "smiles", type: "string", required: false, description: "Query SMILES." },
                { name: "cutoff", type: "number", required: false, description: "Affinity cap in nM." },
            ],
        },
        {
            method: "GET",
            path: "/rest/getLigandsByPDB",
            summary: "Ligands for a single PDB structure (singular form).",
            category: "ligands",
            queryParams: [
                { name: "pdb", type: "string", required: true, description: "PDB identifier." },
                { name: "cutoff", type: "number", required: false, description: "Affinity cap in nM." },
                { name: "identity", type: "number", required: false, description: "Sequence identity cutoff percent." },
            ],
        },
        {
            method: "GET",
            path: "/rest/getLigandsByTarget",
            summary: "Ligands by free-text target name (gene/protein name).",
            category: "ligands",
            queryParams: [
                { name: "target", type: "string", required: true, description: "Target name (gene/protein)." },
                { name: "cutoff", type: "number", required: false, description: "Affinity cap in nM." },
            ],
        },
        {
            method: "GET",
            path: "/rest/getTrgSDFs",
            summary: "Download ligand SDF bundles for a target (returns text; large payloads).",
            category: "bulk",
            queryParams: [
                { name: "uniprot", type: "string", required: false, description: "UniProt accession." },
                { name: "pdb", type: "string", required: false, description: "PDB identifier." },
                { name: "cutoff", type: "number", required: false, description: "Affinity cap in nM." },
            ],
        },
    ],
};
