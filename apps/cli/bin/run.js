#!/usr/bin/env node

import { execute } from "@oclif/core"

// pnpm forwards the conventional script separator to this binary. Accept both
// `pnpm iptv status` and `pnpm iptv -- status` at the repository boundary.
if (process.argv[2] === "--") process.argv.splice(2, 1)

await execute({ dir: import.meta.url })
