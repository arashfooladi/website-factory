"""A pinned download still must not escape the fixture during extraction."""
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).resolve().parents[1] / 'tools/fixture.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtractionSafetyTest(unittest.TestCase):
    def test_traversal_is_rejected_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.writestr('good.txt', 'first entry')
                bundle.writestr('../escaped.txt', 'escape')
            with self.assertRaisesRegex(ValueError, 'Unsafe archive'):
                module.extract_zip(archive, root / 'destination')
            self.assertFalse((root / 'escaped.txt').exists())
            self.assertFalse((root / 'destination/good.txt').exists())

    def test_symlink_entry_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'link.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                info = zipfile.ZipInfo('link')
                info.create_system = 3
                info.external_attr = 0o120777 << 16
                bundle.writestr(info, '/etc/passwd')
            with self.assertRaisesRegex(ValueError, 'Unsafe archive'):
                module.extract_zip(archive, root / 'destination')
