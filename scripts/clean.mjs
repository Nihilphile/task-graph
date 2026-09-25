#!/usr/bin/env node
// Deterministic, dependency-free build cleanup.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
rmSync(path.join(skillRoot, 'dist'), { recursive: true, force: true });
rmSync(path.join(skillRoot, 'tsconfig.tsbuildinfo'), { force: true });
process.stdout.write('cleaned dist\n');
