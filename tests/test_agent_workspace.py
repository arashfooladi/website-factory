import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('agent_workspace',Path(__file__).resolve().parents[1]/'sandbox/agent-workspace.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class AgentWorkspaceTest(unittest.TestCase):
    def test_paths_and_parent_writes_are_rejected(self):
        for path in ['child/../wp-config.php','/etc/passwd','child/.git/config','child//file','parent/../file']:
            with self.assertRaises(ValueError):module.parts(path)
        with self.assertRaisesRegex(ValueError,'read_only_parent'):module.file_handle('parent/style.css',True)

    def test_symlink_files_and_directories_cannot_escape_the_theme(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);child=root/'child';child.mkdir()
            private=root/'private';private.mkdir();(private/'secret').write_text('private')
            (child/'linked').symlink_to(private/'secret')
            (child/'directory').symlink_to(private,target_is_directory=True)
            with patch.dict(module.ROOTS,{'child':child}):
                for name in ['child/linked','child/directory/secret']:
                    with self.assertRaises(OSError):module.read(name)
                with self.assertRaises(ValueError):module.inventory('child')
                with os.fdopen(module.file_handle('child/new/source.css',True),'wb') as target:target.write(b'body{}')
                self.assertEqual(module.read('child/new/source.css'),'body{}')
            self.assertEqual((private/'secret').read_text(),'private')
