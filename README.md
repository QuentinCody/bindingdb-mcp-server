# BindingDB MCP Server

Cloudflare Worker wrapping the [BindingDB REST API](https://www.bindingdb.org/rwd/bind/BindingDBRESTfulAPI.jsp) and public download metadata. Local port: **8881**.

Tools: `bindingdb_search`, `bindingdb_execute`, `bindingdb_query_data`, `bindingdb_get_schema`, each also registered under `mcp_bindingdb_*`. The catalog has six routes: four native REST routes and two adapter-owned bulk discovery operations. September–October 2026 additions are local and have not been deployed.

## Dated downloads and measurement manifests

- `GET /bulk/releases` reads the provider's current [download page](https://www.bindingdb.org/rwd/bind/chemsearch/marvin/Download.jsp). Returns advertised dated TSV filenames, subset/month labels, download/landing URLs and checksum links, with source-page hash and retrieval time. It includes separately listed assay maps. It does not construct missing releases or use the older all-files page's zero-byte placeholders.
- `GET /bulk/manifest` requires an exact `filename` from discovery. Returns the observed provider MD5; optional `expected_md5` rejects checksum drift. It does not fetch the large archive, assert its integrity or infer measurement dates from its filename. Bare digests have unresolved archive/member scope until checked against real bytes.
- Set boolean `include_assays: true` on a measurement manifest to include the advertised `rsid_eaids` and `Assays` archives from the same month, with separate observed digests. Missing companions or sidecars fail the complete request; no other month is substituted. `expected_md5` guards only the requested measurement archive. The returned `assay_join` describes the provider's Reaction Set ID → Entry ID + Assay ID → assay description relationship; it does not execute the join or validate cardinality. Matching month labels do not prove snapshot consistency.
- The [offline manifest builder](scripts/README.md) pins a downloaded TSV/ZIP by SHA-256, preserves all measurements, source fields, qualifiers and publication/curation dates, and optionally annotates temporal availability. Explicit date-column indexes and date formats avoid ambiguous headers and date interpretation. Missing/partial dates stay visible. Full parsing and checksum validation must succeed before output is published.

```javascript
return await api.get("/bulk/releases");
```

Select an exact filename from that result, then call `/bulk/manifest`. The provider recommends its [quarterly UCSD archive](https://library.ucsd.edu/dc/collection/bb03870458) for citing a reproducible historical dataset. Monthly filenames alone do not prove immutability. On October 4, direct native reads verified the collection's 11 advertised objects and the [July 1, 2026 release](https://library.ucsd.edu/dc/object/bb54426945), DOI `10.6075/J06M37T9`. Archive holdings are a separate source; `/bulk/releases` lists the current website, not the archive.

## REST compatibility and evidence

Existing REST responses are retained intact, including any date/source fields actually returned. JSON is requested by default; explicit XML remains supported. Documented empty bodies still map to `{}`. The provider advertises dates for search/download data, but its REST contract does not promise all bulk TSV columns. No date imputation is applied.

The documented `/rest/getTargetByCompound` takes SMILES and a **similarity** coefficient, not an affinity cap; returned compounds may differ from the query structure. Prefer `/rest/getLigandsByUniprots` for separate accession/cutoff parameters; the singular route uses `uniprot=P35355;100`. JSON and explicit XML requests are supported. Native acceptance on October 4 verified all four advertised REST routes. `getLigandsBySmiles`, `getTargetsByCompound`, `getLigandsByPDB` and `getLigandsByTarget` returned 404 and have been removed from discovery. Use the plural PDB route for a single PDB, and `getTargetByCompound` for SMILES similarity.

Every tool's success/error response carries both MCP fields and a verifiable citation. The complete composed response stages above 30KiB, including SQL/schema results; `payloads` and `content_chunks` retain the original envelope. Native affinity rows have SQL projections and complete `native_json`, while `response_context` preserves sibling metadata. Numeric-looking strings and affinity qualifiers stay text. API failures retain status and complete received bodies within the read cap. Execute completeness remains conservative.

REST reads are capped at 2MiB with a 45-second deadline covering headers and body; overly broad queries fail without partial data. Bulk discovery reads only the bounded page and checksum sidecars, with one 30-second deadline; larger artifacts belong in the offline workflow. Partial HTTP 206/Content-Range responses fail explicitly. UTF-8 source text, including BOM, is retained for hashing. No new credentials or hosted backend are required.

October 4 native acceptance:

- The October CSAR and Palmer Taylor ZIPs contain 818 and 14 measurements. Actual date columns are 24 (`Date of publication`) and 25 (`Date in BindingDB`), with month/day/year values. All rows and fields survive the offline manifest. All 14 Palmer Taylor rows flag curation preceding publication; those values are retained.
- Five observed MD5 sidecars match ZIP bytes: CSAR, Palmer Taylor, ITC, reaction mapping and assay descriptions. This observation does not assign checksum scope to future downloads. The ITC file's ten-column header lacks identifiable date columns; the temporal builder rejects the selected date columns and publishes no output.
- The 832 selected measurements all join through same-month mapping to 13 assay descriptions. This validates those rows, not a global one-to-one relationship or an atomic release. The PDSPKi TSV's adjacent checksum link actually names an SDF; discovery correctly reports no matching TSV checksum and refuses its manifest.
- The archived July articles ZIP yields 93,712 verified records, preserving 190 duplicate-ID rows, 12,242 `>` and 497 `<` affinity qualifiers, and 2,334 curation-before-publication anomalies. A `2020-12-31` cutoff annotates 83,984 rows available by both dates and 9,728 after the cutoff. This is not a training split or proof of first historical availability.
- Native EGFR (`P00533`, cutoff 1 nM) returns 3,531 rows/1,037,338 bytes; complete Worker staging, SQL recovery and canonical hashes match. The broader 100 nM response exceeds 5MB and is explicitly refused by the 2MiB cap. Native no-match JSON retains an empty affinity array; the documented empty-body compatibility remains supported separately.

Reproduction and receipts: `scratch/2026-10-04-bindingdb/verification.json`. The actual local Worker uses WorkerLoader and SQLite with TLS verification enabled and installed public CA roots added only to the local test runtime. Production deployment, exhaustive full-database validation and historical first-availability claims are outside this acceptance.

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from BindingDB and stays under the terms of that source: BindingDB-curated data CC BY 3.0; ChEMBL-imported records CC BY-SA 3.0.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
