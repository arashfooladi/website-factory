import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

spec=importlib.util.spec_from_file_location('theme_bundles',Path(__file__).resolve().parents[1]/'tools/theme_bundles.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ThemeBundleSafety(unittest.TestCase):
    def test_parent_updates_have_content_identity_even_when_version_label_is_unchanged(self):
        import uuid
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);original=module.baseline(root,str(uuid.uuid4()))
            archive=root/'update.zip'
            with zipfile.ZipFile(archive,'w') as output:
                for path in (module.PROJECT/'baseline/source/maintheme').rglob('*'):
                    if path.is_file():output.writestr('maintheme/'+str(path.relative_to(module.PROJECT/'baseline/source/maintheme')),path.read_bytes()+(b'\n/* update fixture */\n' if path.name=='style.css' else b''))
            updated=module.import_parent(root,str(uuid.uuid4()),archive,original['id'])
            self.assertEqual(original['versions']['parent'],updated['versions']['parent'])
            self.assertNotEqual(original['sourceDigest'],updated['sourceDigest'])
            self.assertEqual(module.verify(root/'bundles'/original['id'])['sourceDigest'],original['sourceDigest'])
            self.assertEqual(updated['origin']['baseBundleId'],original['id'])
    def test_traversal_and_symbolic_links_are_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for index,name in enumerate(['../escape','/absolute','maintheme/../../escape','C:/escape','maintheme\\escape']):
                archive=root/f'bad-{index}.zip'
                with zipfile.ZipFile(archive,'w') as output:output.writestr(name,b'bad')
                with self.assertRaises(ValueError):module.extract_parent(archive,root/f'out-{index}')
            archive=root/'link.zip'
            with zipfile.ZipFile(archive,'w') as output:
                link=zipfile.ZipInfo('maintheme/link');link.external_attr=0o120777<<16;output.writestr(link,'/etc/passwd')
            with self.assertRaises(ValueError):module.extract_parent(archive,root/'out-link')

if __name__=='__main__':unittest.main()
