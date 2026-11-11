import type { WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";

export const compoundHandoffWorkflow: WorkflowRecipe = {
  title: "PubChem structure to BindingDB similarity candidates",
  description: "Replace the independent aspirin example with the selected PubChem CID and its SMILES property, including stereochemistry/isotopes. Keep all returned monomer IDs, structures, targets, affinity types, values and qualifiers. This native service finds similar compounds; cutoff 1 is not independent proof of chemical identity. Confirm each candidate structure separately before attributing a measurement to the selected PubChem compound. Staged results require bindingdb_get_schema/bindingdb_query_data. No cell-line or potency inference is made.",
  keywords: ["PubChem", "Cellosaurus", "ChEMBL", "compound", "similarity", "identity", "binding"],
  code: `const selection = {pubchem_cid: 2244, smiles: "CC(=O)OC1=CC=CC=C1C(=O)O", similarity_cutoff: 0.85};
if (!Number.isSafeInteger(selection.pubchem_cid) || selection.pubchem_cid < 1 || typeof selection.smiles !== "string" || !selection.smiles.trim() || !Number.isFinite(selection.similarity_cutoff) || selection.similarity_cutoff < 0 || selection.similarity_cutoff > 1) throw new Error("Supply a PubChem CID, its SMILES property and a similarity cutoff in [0,1]");
let candidates;
try { candidates = await api.get("/rest/getTargetByCompound", {smiles: selection.smiles, cutoff: selection.similarity_cutoff}); }
catch (error) { return {selection, __api_error: true, message: error.message, status: error.status, data: error.data}; }
if (candidates?.__api_error || candidates?.__stage_error) return {selection, ...candidates, __api_error: true};
return {selection, candidates, coverage_complete: false, identity_verified: false,
  interpretation: "Candidate measurements are associated with the returned BindingDB monomer structures, not automatically the query compound. Preserve source records, qualifiers and targets. Similarity, including cutoff 1, is not independent structure-identity verification. Cell-assay membership and outcomes remain separate evidence."};`,
};
