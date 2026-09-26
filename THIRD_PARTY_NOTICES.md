# Third-party notices

## Super Productivity

Source: https://github.com/super-productivity/super-productivity
Pinned revision: see [upstream.json](upstream.json).

Copyright (c) 2018 Johannes Millan.
License: MIT; full notice is preserved in [vendor/LICENSE](vendor/LICENSE).

This repository includes copies of:
- packages/sync-core → vendor/sync-core
- packages/shared-schema → vendor/shared-schema
- packages/sync-providers → vendor/sync-providers
- ArchiveCompressionService._compressArchiveData → src/official-archive.ts

src/archive.ts adapts the archive side effects from the pinned upstream implementation.
src/official-entry.ts bundles upstream reducers and operation conversion code.
Test fixtures are obtained from the pinned source archive during setup.
The downloaded source retains its own LICENSE. Generated bundles are local build artifacts.

The MIT notice above applies to upstream-derived code even when that code resides
outside vendor/. The project root LICENSE covers this project's original contributions.

## npm dependencies

Dependencies are declared in package.json and pinned in package-lock.json.
Their respective license files are distributed with the installed packages.
No node_modules or prebuilt dependency bundle is committed.
