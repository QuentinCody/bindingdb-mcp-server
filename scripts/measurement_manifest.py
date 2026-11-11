#!/usr/bin/env python3
"""Build a lossless, checksum-pinned BindingDB measurement manifest offline.

No network, dependencies, normalization, deduplication or silent row filtering.
Column indexes and date format are explicit because provider date labels vary.
"""
import argparse
import calendar
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile
from urllib.parse import urlparse


VERSION = "1"
MAX_LINE = 2 * 1024 * 1024


def date_interval(raw, date_format):
    value = raw.strip()
    result = {"raw": raw, "earliest": None, "latest": None, "precision": "unknown"}
    if not value:
        return result
    try:
        if re.fullmatch(r"\d{4}", value):
            lo, hi, precision = dt.date(int(value), 1, 1), dt.date(int(value), 12, 31), "year"
        elif re.fullmatch(r"\d{4}-\d{2}", value):
            year, month = map(int, value.split("-"))
            lo = dt.date(year, month, 1)
            hi, precision = dt.date(year, month, calendar.monthrange(year, month)[1]), "month"
        elif date_format == "iso" and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            lo = hi = dt.date.fromisoformat(value)
            precision = "day"
        elif date_format in ("mdy", "dmy") and re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", value):
            lo = hi = dt.datetime.strptime(value, "%m/%d/%Y" if date_format == "mdy" else "%d/%m/%Y").date()
            precision = "day"
        else:
            return result
        return {"raw": raw, "earliest": lo.isoformat(), "latest": hi.isoformat(), "precision": precision}
    except ValueError:
        return result


def temporal_partition(publication, curation, cutoff):
    if not cutoff:
        return "not_requested"
    if not publication["earliest"] or not curation["earliest"]:
        return "unknown_date"
    if max(publication["latest"], curation["latest"]) <= cutoff:
        return "available_by_cutoff"
    if max(publication["earliest"], curation["earliest"]) > cutoff:
        return "after_cutoff"
    return "straddles_cutoff"


def hashes(stream):
    sha, md5 = hashlib.sha256(), hashlib.md5(usedforsecurity=False)
    count = 0
    while chunk := stream.read(1024 * 1024):
        sha.update(chunk)
        md5.update(chunk)
        count += len(chunk)
    return {"sha256": sha.hexdigest(), "md5": md5.hexdigest(), "bytes": count}


def validate(args):
    if not re.fullmatch(r"[a-fA-F0-9]{64}", args.sha256):
        raise ValueError("--sha256 must pin the exact input artifact")
    if not re.fullmatch(r"\d{4}(0[1-9]|1[0-2])", args.release):
        raise ValueError("--release must be an explicit YYYYMM source label")
    parsed_url = urlparse(args.source_url)
    if parsed_url.scheme != "https" or not parsed_url.hostname or parsed_url.username or parsed_url.password:
        raise ValueError("--source-url must identify the HTTPS source artifact or archive landing page")
    for name in (Path(args.input).name, Path(parsed_url.path).name):
        named_release = re.search(r"_(\d{6})_tsv\.zip$", name)
        if named_release and named_release[1] != args.release:
            raise ValueError("Selected release label contradicts the dated artifact filename")
    indexes = [args.id_column, args.publication_column, args.curation_column]
    if min(indexes) < 1 or len(set(indexes)) != 3:
        raise ValueError("Select three distinct one-based ID/publication/curation column indexes")
    if args.date_format not in ("iso", "mdy", "dmy"):
        raise ValueError("Unsupported date format")
    if args.cutoff and (not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.cutoff) or dt.date.fromisoformat(args.cutoff).isoformat() != args.cutoff):
        raise ValueError("--cutoff must be an exact ISO date")
    if bool(args.md5) != bool(args.md5_scope):
        raise ValueError("--md5 and --md5-scope must be supplied together; never guess sidecar scope")
    if args.md5 and not re.fullmatch(r"[a-fA-F0-9]{32}", args.md5):
        raise ValueError("Invalid MD5")
    if args.max_bytes < 1:
        raise ValueError("--max-bytes must be positive")
    if Path(args.output).exists():
        raise ValueError("Output already exists; choose a new directory")


def measurement_record(cells, indexes, args, partitions, date_quality, line_number, raw):
    publication = date_interval(cells[indexes[1]], args.date_format)
    curation = date_interval(cells[indexes[2]], args.date_format)
    partition = temporal_partition(publication, curation, args.cutoff)
    partitions[partition] = partitions.get(partition, 0) + 1
    date_quality["publication_unknown"] += publication["earliest"] is None
    date_quality["curation_unknown"] += curation["earliest"] is None
    date_quality["curation_definitely_precedes_publication"] += bool(curation["latest"] and publication["earliest"] and curation["latest"] < publication["earliest"])
    record = {
        "measurement_id": cells[indexes[0]], "source_line": line_number,
        "raw_line_sha256": hashlib.sha256(raw).hexdigest(),
        "publication": publication, "curation": curation, "temporal_partition": partition,
        # Positional values preserve repeated headers and variable multichain tails.
        "values": cells,
    }
    return record


def process_rows(stream, out, args):
    sha, md5 = hashlib.sha256(), hashlib.md5(usedforsecurity=False)
    record_sha = hashlib.sha256()
    total_bytes, count, width_variations = 0, 0, 0
    columns = None
    indexes = [args.id_column - 1, args.publication_column - 1, args.curation_column - 1]
    partitions = {}
    date_quality = {"publication_unknown": 0, "curation_unknown": 0, "curation_definitely_precedes_publication": 0}
    with out.open("wb") as output:
        for line_number, raw in enumerate(iter(lambda: stream.readline(MAX_LINE + 1), b""), 1):
            if len(raw) > MAX_LINE:
                raise ValueError(f"Line {line_number} exceeds 2MiB")
            total_bytes += len(raw)
            if total_bytes > args.max_bytes:
                raise ValueError("Uncompressed data exceeds --max-bytes; no complete manifest published")
            sha.update(raw)
            md5.update(raw)
            line = raw.decode("utf-8-sig" if line_number == 1 else "utf-8").rstrip("\r\n")
            cells = line.split("\t")
            if len(cells) <= max(indexes):
                raise ValueError(f"Line {line_number} lacks an explicitly selected column")
            if columns is None:
                columns = cells
                continue
            if not cells[indexes[0]].strip():
                raise ValueError(f"Line {line_number} has no measurement ID")
            record = measurement_record(cells, indexes, args, partitions, date_quality, line_number, raw)
            encoded = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            output.write(encoded)
            record_sha.update(encoded)
            count += 1
            width_variations += len(cells) != len(columns)
    if columns is None or count == 0:
        raise ValueError("Input has no measurements")
    return {
        "columns": columns, "rows": count, "variable_width_rows": width_variations,
        "member": {"sha256": sha.hexdigest(), "md5": md5.hexdigest(), "bytes": total_bytes},
        "records_sha256": record_sha.hexdigest(), "partitions": partitions, "date_quality": date_quality,
    }


def measurement_stream(artifact, stack, args):
    if zipfile.is_zipfile(artifact):
        artifact.seek(0)
        archive = stack.enter_context(zipfile.ZipFile(artifact))
        choices = [info for info in archive.infolist() if not info.is_dir() and info.filename.lower().endswith(".tsv")]
        selected = [info for info in choices if info.filename == args.member] if args.member else choices
        if len(selected) != 1:
            raise ValueError("Select exactly one TSV archive member with --member")
        info = selected[0]
        if info.file_size > args.max_bytes:
            raise ValueError("TSV member exceeds --max-bytes")
        stream = stack.enter_context(archive.open(info))
        member_name = info.filename
    else:
        if args.member:
            raise ValueError("--member is only valid for ZIP input")
        artifact.seek(0)
        stream, member_name = artifact, None
    return stream, member_name


def build(args):
    validate(args)
    source, output = Path(args.input), Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=".bindingdb-manifest-", dir=output.parent))
    try:
        with source.open("rb") as artifact:
            artifact_hash = hashes(artifact)
            if artifact_hash["sha256"] != args.sha256.lower():
                raise ValueError("Artifact SHA-256 mismatch")
            if args.md5_scope == "artifact" and artifact_hash["md5"] != args.md5.lower():
                raise ValueError("Artifact MD5 mismatch")
            artifact.seek(0)
            with contextlib.ExitStack() as stack:
                stream, member_name = measurement_stream(artifact, stack, args)
                details = process_rows(stream, temp / "measurements.jsonl", args)
            if args.md5_scope == "member" and details["member"]["md5"] != args.md5.lower():
                raise ValueError("Uncompressed member MD5 mismatch")
            # Detect mutation between the initial content pin and streaming parse.
            artifact.seek(0)
            if hashes(artifact) != artifact_hash:
                raise ValueError("Input artifact changed while building the manifest")
        manifest = {
            "schema": "bindingdb-measurement-manifest", "schema_version": VERSION,
            "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "source": {"url": args.source_url, "archive_doi": args.archive_doi, "release_label": args.release,
                       "release_label_basis": "explicit operator selection; checksum pins bytes, not historical availability",
                       "filename": source.name, **artifact_hash},
            "member_name": member_name, **details,
            "column_mapping": {"id": args.id_column, "publication": args.publication_column, "curation": args.curation_column, "index_base": 1},
            "date_format": args.date_format, "cutoff": args.cutoff,
            "provider_md5_check": {"expected": args.md5, "scope": args.md5_scope, "verified": bool(args.md5)},
            "records_file": "measurements.jsonl",
            "policy": "All rows retained, including duplicate IDs, missing/invalid dates and censored affinity values. Availability uses both publication and curation date intervals. Only available_by_cutoff is unambiguously on/before the cutoff; unknown/straddling rows must not silently enter training. No date imputation or train/test assignment. Publication and curation dates do not prove exact historical database availability; compound/target/source grouping and cross-dataset leakage checks remain necessary.",
        }
        (temp / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if output.exists():
            raise ValueError("Output appeared during processing; refusing to replace it")
        os.rename(temp, output)
        return manifest
    except BaseException:
        shutil.rmtree(temp, ignore_errors=True)
        raise


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, help="Local ZIP or TSV artifact; no network download")
    p.add_argument("--output", required=True, help="New output directory, published only after full validation")
    p.add_argument("--sha256", required=True, help="Expected SHA-256 of exact input bytes")
    p.add_argument("--source-url", required=True)
    p.add_argument("--release", required=True, help="Explicit YYYYMM source label")
    p.add_argument("--archive-doi", help="Optional archive DOI, retained as supplied, not resolved")
    p.add_argument("--member", help="Exact ZIP TSV member; required when ambiguous")
    p.add_argument("--id-column", type=int, required=True)
    p.add_argument("--publication-column", type=int, required=True)
    p.add_argument("--curation-column", type=int, required=True)
    p.add_argument("--date-format", required=True, choices=["iso", "mdy", "dmy"])
    p.add_argument("--cutoff", help="Optional ISO date; retains every row and annotates availability")
    p.add_argument("--md5")
    p.add_argument("--md5-scope", choices=["artifact", "member"])
    p.add_argument("--max-bytes", type=int, default=20 * 1024**3, help="Uncompressed byte cap, default 20GiB")
    return p


if __name__ == "__main__":
    try:
        result = build(parser().parse_args())
        print(json.dumps({"rows": result["rows"], "source_sha256": result["source"]["sha256"], "records_sha256": result["records_sha256"]}))
    except (ValueError, OSError, UnicodeError, zipfile.BadZipFile) as error:
        raise SystemExit(str(error)) from error
