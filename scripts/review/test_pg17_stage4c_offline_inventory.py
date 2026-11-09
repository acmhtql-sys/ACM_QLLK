"""Run with: python -m unittest discover -s scripts/review -p 'test_pg17_stage4c_offline_inventory.py'"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).parent / "pg17_stage4c_offline_inventory.py"


class OfflineInventorySafetyTests(unittest.TestCase):
    def invoke(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            capture_output=True, text=True, check=False,
        )

    def test_baseline_only_is_never_a_go(self):
        with tempfile.TemporaryDirectory() as d:
            schema = Path(d) / "schema.prisma"
            schema.write_text("model Role {\n  id String @id\n}\nmodel User {\n  id String @id\n}\n")
            result = self.invoke("--baseline", str(schema))
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["status"], "PG3_ENTRY_REVIEW_ONLY_NO_GO")
            self.assertEqual(data["baseline"]["model_count"], 2)
            self.assertFalse(data["all_four_artifacts_present"])
            self.assertFalse(data["baseline"]["execution_authorized"])

    def test_no_execution_even_when_four_files_provided(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            base, candidate = p / "schema.prisma", p / "candidate.prisma"
            forward, rollback = p / "forward.sql.txt", p / "rollback.sql.txt"
            base.write_text("model Role {\n id String @id\n}\n")
            candidate.write_text("model Role {\n id String @id\n}\nmodel BorrowReturnOperation {\n id String @id\n}\n")
            forward.write_text("-- REVIEW ONLY, DO NOT EXECUTE\n")
            rollback.write_text("-- REVIEW ONLY, DO NOT EXECUTE\n")
            result = self.invoke("--baseline", str(base), "--candidate", str(candidate),
                                 "--forward", str(forward), "--rollback", str(rollback))
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(data["model_delta"]["added"], ["BorrowReturnOperation"])
            self.assertTrue(data["all_four_artifacts_present"])
            self.assertFalse(data["forward_sql"]["execution_authorized"])
            self.assertFalse(data["guarded_rollback_sql"]["execution_authorized"])

    def test_refuses_non_schema_file_without_leaking_contents(self):
        with tempfile.TemporaryDirectory() as d:
            secret = Path(d) / ".env"
            secret.write_text("PASSWORD=secret")
            result = self.invoke("--baseline", str(secret))
            self.assertEqual(result.returncode, 2)
            self.assertNotIn("PASSWORD", result.stdout)


if __name__ == "__main__":
    unittest.main()
