# BindingDB measurement manifests

`measurement_manifest.py` is an offline Python 3.10+ standard-library utility. It reads a complete local TSV or ZIP member and writes `manifest.json` plus `measurements.jsonl`. No Worker, credentials, installed scientific packages or network access are required. October 4 acceptance processed 94,544 native measurements across two monthly subsets and one archived release subset, checking every positional field and original line hash.

## Source selection and integrity

1. Use MCP `api.get("/bulk/releases")`, then `api.get("/bulk/manifest", {filename: "<exact advertised filename>"})`. Save the returned source and checksum metadata. For durable research citations, BindingDB recommends its [quarterly UCSD archive](https://library.ucsd.edu/dc/collection/bb03870458). Direct native access worked on October 4; the tool does not enumerate its holdings. The [July 1, 2026 object](https://library.ucsd.edu/dc/object/bb54426945) and its README identify DOI `10.6075/J06M37T9` and release `202607`.
2. Obtain the exact artifact through the provider's published download/landing link. Verify any MD5 sidecar against the archive or uncompressed member as appropriate. The observed sidecars contain a bare digest, so the implementation does **not** guess checksum scope. Retain the source artifact and record its SHA-256; SHA-256 is the required content pin for this utility.
3. Inspect the actual TSV header and choose **one-based** measurement-ID, publication-date and curation-date column indexes. Both date columns are mandatory selections. The inspected July 2026 articles and October 2026 CSAR/Palmer Taylor files use columns 1, 24 and 25, labeled `BindingDB Reactant_set_id`, `Date of publication` and `Date in BindingDB`, with `--date-format mdy`. Do not assume these indexes across products: the October ITC TSV has a malformed ten-column header without identifiable date columns and fails this selection. The older TSV PDF's repeated date label is not used to override the actual header.
4. Run the utility with the explicit selection below. Replace every placeholder; the three column indexes shown here are symbolic, not recommendations.

```text
python3 servers/bindingdb-mcp-server/scripts/measurement_manifest.py \
  --input /path/to/exact-source.zip \
  --output /path/to/new-manifest-directory \
  --source-url https://www.bindingdb.org/rwd/bind/downloads/EXACT_FILENAME \
  --release YYYYMM \
  --sha256 VERIFIED_ARTIFACT_SHA256 \
  --id-column ID_COLUMN_INDEX \
  --publication-column PUBLICATION_COLUMN_INDEX \
  --curation-column CURATION_COLUMN_INDEX \
  --date-format iso \
  --cutoff 2024-12-31
```

`--date-format` selects ISO day dates (`iso`), month/day/four-digit-year (`mdy`) or day/month/four-digit-year (`dmy`). Explicit ISO years and year-months retain interval precision under all three settings. Two-digit years, invalid calendar dates and unsupported strings stay unknown, with original text intact. `--member` selects an exact TSV member when a ZIP is ambiguous. `--md5 DIGEST --md5-scope artifact|member` optionally requires the provider digest to match the explicitly selected byte stream. `--archive-doi` records an operator-supplied citation without resolving or verifying it. The default uncompressed cap is 20GiB (`--max-bytes`); each TSV line is bounded to 2MiB.

## Output and interpretation

- `manifest.json` records source URL/release label, artifact SHA-256/MD5/size, optional archive DOI, selected ZIP member, uncompressed hashes, complete header array, explicit column mapping, date policy, counts and the SHA-256 of `measurements.jsonl`. The release label is operator-selected and checked against dated filenames when present; the byte pin does not prove historical availability.
- Every JSONL record has the measurement ID as text, original source line number, raw-line hash, original positional field values, publication/curation raw dates and date intervals. Positional values preserve duplicate headers and variable trailing protein-chain fields. No rows or duplicate IDs are removed, and affinity qualifiers/units are not converted. To reconstruct field meaning, use the manifest header and provider multichain documentation; do not blindly zip only the first header-width cells.
- An optional cutoff annotates `available_by_cutoff`, `after_cutoff`, `straddles_cutoff` or `unknown_date` using **both** date intervals. It does not drop rows or assign training/test sets. Unknown and straddling dates must not silently enter a pre-cutoff training set. A future cutoff relative to an incomplete snapshot does not create a complete future cohort.
- Dates do not prove first database availability. Compound/target/source grouping, duplicates across datasets and other model leakage controls remain separate scientific decisions. Curation dates definitely preceding publication dates are counted for review.

Output is published as a new directory only after complete parsing and verification. SHA mismatches, wrong MD5 scope, malformed/short rows, ambiguous ZIP members, byte limits and source mutation fail the build; temporary output is removed. Existing output is never intentionally replaced. Keep the source archive: the JSONL stores field values and raw-line hashes, not original line-ending bytes.

Native archive acceptance used the [July articles component](https://library.ucsd.edu/dc/object/bb54426945/_4_1.zip/download), an 18,114,757-byte ZIP pinned to SHA-256 `d2584d1519318d00ab5f46289da5ab3549affe732d598a5072f8777b6b3b5262`. Its 93,712 rows include 190 duplicate-ID rows and 2,334 curation-before-publication anomalies; all remain in the output. At cutoff `2020-12-31`, 83,984 satisfy both dates and 9,728 fall after it. The emitted records hash is `602811cd07589701d446f06e2f9702f7bf2ccad5c2461ba9e31f73bbb2931544`. The archive DOI/release were verified against native metadata and README outside the builder; the builder itself does not resolve DOI claims. No provider MD5 was supplied for this archive component.

Assay text is a separate source product. BindingDB documents joins from measurement reaction-set ID via `BindingDB_rsid_eaids` to EntryID + AssayID and then `BindingDB_Assays`. Discovery exposes these dated files separately. This builder does not silently join current assay maps into an older measurement snapshot; select, pin and validate matching artifacts separately.

Tests:

```bash
python3 -m unittest discover -s servers/bindingdb-mcp-server/scripts -p 'test_*.py'
```
