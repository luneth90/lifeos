import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function resolveVersion(): string {
	try {
		return (require('../../../package.json') as { version: string }).version;
	} catch {
		return '0.0.0-dev';
	}
}

export const VERSION: string = resolveVersion();
