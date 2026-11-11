import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from measurement_manifest import build, date_interval, parser, temporal_partition


TSV = ("BindingDB Reactant_set_id\tDate of publication\tDate of publication\tKi (nM)\tChain\n"
       "001\t2020-03-04\t2020-05-01\t>1000\tABC\n"
       "001\t2020\t2021-01-01\t<0.1\tDEF\tEXTRA_CHAIN\n"
       "003\t\t2020-01\t=10\tGHI\n"
       "004\t2020\t2020-01\t10\tJKL\n").encode()


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "BindingDB_All_202609_tsv.zip"
        with zipfile.ZipFile(self.source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("BindingDB_All.tsv", TSV)
        self.args = parser().parse_args([
            "--input", str(self.source), "--output", str(self.root / "out"),
            "--sha256", hashlib.sha256(self.source.read_bytes()).hexdigest(),
            "--source-url", "https://www.bindingdb.org/rwd/bind/downloads/BindingDB_All_202609_tsv.zip",
            "--release", "202609", "--id-column", "1", "--publication-column", "2", "--curation-column", "3",
            "--date-format", "iso", "--cutoff", "2020-06-30",
        ])

    def test_zip_manifest_preserves_duplicates_qualifiers_and_variable_chain_columns(self):
        result = build(self.args)
        records_bytes = (self.root / "out/measurements.jsonl").read_bytes()
        records = [json.loads(line) for line in records_bytes.splitlines()]
        self.assertEqual(result["rows"], 4)
        self.assertEqual(result["variable_width_rows"], 1)
        self.assertEqual(result["columns"][1:3], ["Date of publication"] * 2)
        self.assertEqual([r["measurement_id"] for r in records], ["001", "001", "003", "004"])
        self.assertEqual(records[0]["values"][3], ">1000")
        self.assertEqual(records[1]["values"][-1], "EXTRA_CHAIN")
        self.assertEqual([r["temporal_partition"] for r in records], ["available_by_cutoff", "after_cutoff", "unknown_date", "straddles_cutoff"])
        self.assertEqual(result["records_sha256"], hashlib.sha256(records_bytes).hexdigest())
        self.assertEqual(result["member"]["sha256"], hashlib.sha256(TSV).hexdigest())
        self.assertEqual(records[0]["raw_line_sha256"], hashlib.sha256(TSV.splitlines(keepends=True)[1]).hexdigest())
        self.assertEqual(json.loads((self.root / "out/manifest.json").read_text())["source"]["sha256"], self.args.sha256)

    def test_md5_scope_is_explicit_and_verified(self):
        for scope, data in [("artifact", self.source.read_bytes()), ("member", TSV)]:
            with self.subTest(scope=scope):
                self.args.output = str(self.root / scope)
                self.args.md5_scope = scope
                self.args.md5 = hashlib.md5(data, usedforsecurity=False).hexdigest()
                self.assertTrue(build(self.args)["provider_md5_check"]["verified"])

    def test_plain_tsv_utf8_bom_and_trailing_blank_cells(self):
        data = b"\xef\xbb\xbfID\tPublication\tCuration\tOther\r\n1\t2020-01-01\t2020-02-01\t\r\n"
        self.source.write_bytes(data)
        self.args.sha256 = hashlib.sha256(data).hexdigest()
        result = build(self.args)
        self.assertEqual(result["columns"][0], "ID")
        self.assertIsNone(result["member_name"])
        row = json.loads((self.root / "out/measurements.jsonl").read_text())
        self.assertEqual(row["values"][-1], "")

    def test_bad_pins_and_invalid_columns_never_publish_partial_output(self):
        cases = [{"sha256": "0" * 64}, {"md5": "0" * 32, "md5_scope": "artifact"}, {"md5": "0" * 32, "md5_scope": "member"}, {"md5": "0" * 32}, {"publication_column": 1}, {"curation_column": 99}, {"max_bytes": 5}, {"release": "202608"}]
        original = vars(self.args).copy()
        for changes in cases:
            with self.subTest(changes=changes):
                vars(self.args).update(original)
                vars(self.args).update(changes)
                with self.assertRaises(ValueError):
                    build(self.args)
                self.assertFalse((self.root / "out").exists())
                self.assertEqual(list(self.root.glob(".bindingdb-manifest-*")), [])

    def test_ambiguous_archive_requires_member(self):
        with zipfile.ZipFile(self.source, "a") as archive:
            archive.writestr("other.tsv", TSV)
        self.args.sha256 = hashlib.sha256(self.source.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, "exactly one"):
            build(self.args)
        self.args.member = "BindingDB_All.tsv"
        self.assertEqual(build(self.args)["rows"], 4)

    def test_existing_output_is_preserved(self):
        build(self.args)
        manifest = (self.root / "out/manifest.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "already exists"):
            build(self.args)
        self.assertEqual((self.root / "out/manifest.json").read_bytes(), manifest)

    def test_partial_and_invalid_dates_do_not_get_imputed(self):
        for raw in ["", "2020-02-30", "02/03/20", "not known", "2020-13"]:
            with self.subTest(raw=raw):
                self.assertEqual(date_interval(raw, "iso")["precision"], "unknown")
                self.assertEqual(date_interval(raw, "iso")["raw"], raw)
        self.assertEqual(date_interval("2020-02", "iso")["latest"], "2020-02-29")
        self.assertEqual(date_interval("02/03/2020", "mdy")["earliest"], "2020-02-03")
        self.assertEqual(date_interval("02/03/2020", "dmy")["earliest"], "2020-03-02")
        self.assertEqual(date_interval("02/03/2020", "iso")["precision"], "unknown")

    def test_boundary_uses_both_dates_and_never_calls_partitions_train_test(self):
        pub = date_interval("2020-01-01", "iso")
        cur = date_interval("2020-06-30", "iso")
        self.assertEqual(temporal_partition(pub, cur, "2020-06-30"), "available_by_cutoff")
        self.assertEqual(temporal_partition(pub, date_interval("2020-07", "iso"), "2020-06-30"), "after_cutoff")
        self.assertEqual(temporal_partition(pub, cur, None), "not_requested")

    def test_missing_columns_malformed_utf8_and_oversized_rows_fail_closed(self):
        for data in [b"id\tpub\tcur\n1\t2020\n", b"id\tpub\tcur\n1\t\xff\t2020\n", b"id\tpub\tcur\n1\t" + b"a" * (2 * 1024 * 1024) + b"\t2020\n"]:
            self.source.write_bytes(data)
            self.args.sha256 = hashlib.sha256(data).hexdigest()
            with self.assertRaises((ValueError, UnicodeError)):
                build(self.args)
            self.assertFalse((self.root / "out").exists())


if __name__ == "__main__":
    unittest.main()
