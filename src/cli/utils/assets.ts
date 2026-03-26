import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// dist/cli/utils/ → up 3 levels to package root
const PACKAGE_ROOT = join(__dirname, '..', '..', '..');

export function assetsDir(): string {
	return join(PACKAGE_ROOT, 'assets');
}

export function ensureDir(dir: string): boolean {
	if (existsSync(dir)) return false;
	mkdirSync(dir, { recursive: true });
	return true;
}

export function copyDir(src: string, dest: string): void {
	cpSync(src, dest, { recursive: true });
}
