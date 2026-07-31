import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export interface MarkdownAsset {
	frontmatter: Record<string, unknown>;
	body: string;
}

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

function readAsset(relativePath: string): string {
	return readFileSync(join(repositoryRoot, relativePath), 'utf-8');
}

export function readMarkdownAsset(relativePath: string): MarkdownAsset {
	const content = readAsset(relativePath);
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) throw new Error(`缺少 frontmatter：${relativePath}`);
	const frontmatter = parseYaml(match[1]);
	if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
		throw new Error(`frontmatter 必须是对象：${relativePath}`);
	}
	return { frontmatter: frontmatter as Record<string, unknown>, body: match[2] };
}

export function readContractYaml(relativePath: string, marker: string): unknown {
	const content = readAsset(relativePath);
	const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = content.match(
		new RegExp(`<!--\\s*${escapedMarker}\\s*-->\\s*\\n` + '```yaml\\n([\\s\\S]*?)\\n```'),
	);
	if (!match) throw new Error(`缺少契约块 ${marker}：${relativePath}`);
	return parseYaml(match[1]);
}

export function extractPlaceholders(content: string): string[] {
	return [...content.matchAll(/\{\{\s*[^{}]+?\s*\}\}/g)].map((match) => match[0]);
}

export function pairedAssetPaths(relativeDirectory: string): Array<{ zh: string; en: string }> {
	const zhDirectory = join(repositoryRoot, relativeDirectory, 'zh');
	const enDirectory = join(repositoryRoot, relativeDirectory, 'en');
	return readdirSync(zhDirectory)
		.filter((name) => name.endsWith('.md'))
		.sort()
		.map((name) => {
			const enPath = join(enDirectory, name);
			readFileSync(enPath, 'utf-8');
			return {
				zh: join(relativeDirectory, 'zh', name),
				en: join(relativeDirectory, 'en', name),
			};
		});
}
