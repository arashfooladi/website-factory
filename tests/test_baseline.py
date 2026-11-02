"""Release safety tests: package determinism, symlinks and unsafe files."""
import importlib.util
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('package_baseline', Path(__file__).resolve().parents[1] / 'tools/package_baseline.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BaselineArchiveTest(unittest.TestCase):
    def test_archive_is_reproducible_and_has_one_root(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'client-theme'
            source.mkdir()
            (source / 'style.css').write_text('/* client theme */')
            first = module.archive(source)
            (source / 'style.css').touch()
            self.assertEqual(first, module.archive(source))
            with zipfile.ZipFile(io.BytesIO(first)) as bundle:
                self.assertEqual(bundle.namelist(), ['client-theme/style.css'])
                self.assertIsNone(bundle.testzip())

    def test_archive_rejects_links_outside_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'theme'
            source.mkdir()
            (source / 'secret').symlink_to('/etc/passwd')
            with self.assertRaisesRegex(ValueError, 'symlinks'):
                module.archive(source)

    def test_archive_rejects_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'theme'
            source.mkdir()
            (source / 'debug.log').write_text('private runtime data')
            with self.assertRaisesRegex(ValueError, 'Unwanted release'):
                module.archive(source)
