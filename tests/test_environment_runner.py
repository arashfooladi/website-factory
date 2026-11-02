import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import environments

class EnvironmentRunnerTest(unittest.TestCase):
    def test_non_uuid_paths_are_rejected(self):
        for value in ['../../controller', '/etc', 'client-name']:
            with self.assertRaises(ValueError): environments.location(value)

    def test_snapshot_rejects_symlinks_without_reading_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'link').symlink_to('/etc/passwd')
            with self.assertRaisesRegex(ValueError,'snapshot_symlink_rejected'): environments.hashes(root)

    def test_command_output_is_bounded(self):
        with self.assertRaisesRegex(RuntimeError,'environment_output_limit'):
            environments.checked([sys.executable,'-c','print("x"*2_000_000)'])

    def test_command_timeout_terminates_the_host_child(self):
        with self.assertRaisesRegex(RuntimeError,'environment_command_timeout'):
            environments.checked([sys.executable,'-c','import time; time.sleep(5)'], timeout=0.1)

    def test_interrupted_snapshot_and_restore_recover_without_partial_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = {'id': 'a4c053c4-644e-458c-bc96-4296bbb1aa19', 'limits': {'diskMiB': 10}}
            snapshot_id = '16143b0c-ea5e-4657-bc2c-5a1a4f73819c'
            for name in ['workspace', 'uploads', 'cache', 'data']:
                (root / name).mkdir()
                (root / name / 'original').write_text(name)
            partial = root / 'snapshots' / snapshot_id
            partial.mkdir(parents=True)
            (partial / 'orphan').write_text('partial copy')
            with patch.object(environments.subprocess, 'run', return_value=SimpleNamespace(returncode=3)):
                first = environments.snapshot(root, data, snapshot_id)
                self.assertEqual(environments.snapshot(root, data, snapshot_id), first)
            self.assertFalse((partial / 'orphan').exists())
            # A previous restore stopped between removing and copying data.
            environments.shutil.rmtree(root / 'data')
            (root / 'workspace' / 'original').write_text('changed')
            data['initialized'] = True
            with patch.object(environments, 'stop'):
                environments.restore(root, data, snapshot_id)
            self.assertFalse(data['initialized'])
            for name in ['workspace', 'uploads', 'cache', 'data']:
                self.assertEqual((root / name / 'original').read_text(), name)
            (partial / 'data' / 'original').write_text('corrupted')
            with patch.object(environments, 'stop'):
                with self.assertRaisesRegex(ValueError, 'snapshot_hash_mismatch'):
                    environments.restore(root, data, snapshot_id)
            self.assertEqual((root / 'data' / 'original').read_text(), 'data')
