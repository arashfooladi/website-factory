# MainTheme baseline provenance

Imported from the clean local MainTheme 0.4.0 distribution at source commit `577aa68`. The original three installable ZIPs are preserved in `upstream/`. Their SHA-256 hashes match the distribution in `/home/arash/Downloads/Maintheme-0.4.0`.

Factory baseline revision: **0.4.0-factory.1**. This is an artifact revision; the upstream theme/plugin version headers remain 0.4.0 until executable behavior changes require a versioned release.

Intentional change: the bundled `vazirmatn.woff2` was accompanied by an unrelated Euphoria Script/Linux Libertine license notice. Replace `maintheme/assets/fonts/OFL.txt` with the Vazirmatn project's license at the exact upstream commit recorded in `font-license-provenance.json`. The original source/package notice also differed in line endings. Rebuilding canonical archives resolves both issues.

`manifest.json` binds the upstream archives, each source file and the deterministic factory archives. Baseline ZIPs use uncompressed entries, fixed ordering, timestamps and permissions so hashes do not depend on the host's compression-library version. `tools/package_baseline.py --check` fails on source or package drift. Use `--write-lock` only after deliberately reviewing a baseline change. Factory builds never rewrite that lock implicitly.

