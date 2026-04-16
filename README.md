# bindingdb-mcp-server

MCP server wrapping the [BindingDB REST API](https://bindingdb.org/rwd/bind/BindingDB_REST.jsp) — a public database of measured binding affinities of drug-like molecules to protein targets.

Runs on Cloudflare Workers. Exposes four Code Mode tools (`bindingdb_search`, `bindingdb_execute`, `bindingdb_query_data`, `bindingdb_get_schema`) plus a convenience `bindingdb_ligands_by_pdb`.

- Upstream docs: https://bindingdb.org/rwd/bind/BindingDB_REST.jsp
- Base URL: `https://bindingdb.org`
- Local dev port: 8881
- Category focus: ligand lookups (by PDB, UniProt, SMILES similarity), targets-by-compound, and bulk SDF retrieval.

BindingDB defaults to XML — the adapter injects `response=application/json`. Empty-result queries sometimes return an empty body (200 OK, no text); the adapter maps these to `{}` instead of throwing a JSON parse error.
