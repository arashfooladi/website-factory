import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('factory_supervisor', Path(__file__).resolve().parents[1] / 'sandbox/supervisor.py')
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


class EnvironmentDatabaseTest(unittest.TestCase):
    def test_partial_initialization_retries_but_completed_site_data_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            log = root.parent / (root.name + '.log')
            try:
                (root / 'mysql').mkdir()
                (root / 'mysql/partial').write_text('unfinished system tables')
                with patch.object(supervisor.subprocess, 'run', side_effect=subprocess.TimeoutExpired('installer',180)):
                    with self.assertRaises(subprocess.TimeoutExpired): supervisor.initialize_database(root, log, True)
                self.assertFalse((root / '.factory-database-ready').exists())
                def install(*args, **kwargs):
                    self.assertFalse((root / 'mysql/partial').exists())
                    (root / 'mysql').mkdir(exist_ok=True)
                    return SimpleNamespace(returncode=0)
                with patch.object(supervisor.subprocess, 'run', side_effect=install):
                    supervisor.initialize_database(root, log, True)
                (root / 'site_client').mkdir()
                (root / 'site_client/product').write_text('client product')
                with patch.object(supervisor.subprocess, 'run') as installer:
                    supervisor.initialize_database(root, log, True)
                    installer.assert_not_called()
                self.assertEqual((root / 'site_client/product').read_text(), 'client product')
                (root / '.factory-database-ready').unlink()
                with self.assertRaisesRegex(RuntimeError,'needs review'): supervisor.initialize_database(root, log, True)
                self.assertEqual((root / 'site_client/product').read_text(), 'client product')
            finally: log.unlink(missing_ok=True)

    def test_missing_system_tables_do_not_erase_an_initialized_database(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / '.factory-database-ready').write_text('1\n')
            (root / 'client-data').write_text('preserve')
            with self.assertRaisesRegex(RuntimeError,'system tables are missing'):
                supervisor.initialize_database(root, root / 'log', True)
            self.assertEqual((root / 'client-data').read_text(), 'preserve')
