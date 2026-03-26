export interface ParsedArgs {
	positionals: string[];
	flags: Record<string, string | true>;
}

export function parseArgs(
	args: string[],
	known: Record<string, { alias?: string; default?: string }>,
): ParsedArgs {
	const result: ParsedArgs = { positionals: [], flags: {} };

	// Build lookup maps: flag name → canonical name, and alias → canonical name
	const aliasMap = new Map<string, string>();
	for (const [name, opts] of Object.entries(known)) {
		if (opts.alias) {
			aliasMap.set(opts.alias, name);
		}
	}

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		if (arg.startsWith('--')) {
			const eqIdx = arg.indexOf('=');
			if (eqIdx !== -1) {
				// --lang=zh form
				const name = arg.slice(2, eqIdx);
				const value = arg.slice(eqIdx + 1);
				result.flags[name] = value;
			} else {
				const name = arg.slice(2);
				const spec = known[name];
				// If next arg exists and doesn't look like a flag, treat as value
				const next = args[i + 1];
				if (next !== undefined && !next.startsWith('-')) {
					if (spec) {
						// Known flag — consume next arg as value
						result.flags[name] = next;
						i++;
					} else {
						// Unknown flag — treat as boolean
						result.flags[name] = true;
					}
				} else {
					result.flags[name] = true;
				}
			}
		} else if (arg.startsWith('-') && arg.length === 2) {
			// Short alias: -l zh
			const alias = arg.slice(1);
			const canonical = aliasMap.get(alias);
			const name = canonical ?? alias;
			const next = args[i + 1];
			if (next !== undefined && !next.startsWith('-')) {
				result.flags[name] = next;
				i++;
			} else {
				result.flags[name] = true;
			}
		} else {
			result.positionals.push(arg);
		}
		i++;
	}

	// Apply defaults for missing flags
	for (const [name, opts] of Object.entries(known)) {
		if (opts.default !== undefined && result.flags[name] === undefined) {
			result.flags[name] = opts.default;
		}
	}

	return result;
}

// ANSI output helpers (no chalk dependency)
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export function log(icon: string, msg: string) {
	console.log(`${icon} ${msg}`);
}
