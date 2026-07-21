import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LANG_SUFFIX_RE = /^(.+)\.(zh|en)\.md$/;
const PYTHON_BYTECODE_RE = /\.(?:pyc|pyo)$/i;

export function isGeneratedPythonCacheEntry(entry: string): boolean {
	return entry === '__pycache__' || PYTHON_BYTECODE_RE.test(entry);
}

export function resolveSkillFiles(skillDir: string, lang: 'zh' | 'en'): Map<string, string> {
	const result = new Map<string, string>();
	walk(skillDir, skillDir, lang, result);
	return result;
}

function walk(base: string, dir: string, lang: string, out: Map<string, string>) {
	for (const entry of readdirSync(dir)) {
		// Python 执行技能脚本时可能在源码或已安装目录生成缓存；它们不是发布资产。
		if (isGeneratedPythonCacheEntry(entry)) continue;
		const full = join(dir, entry);
		const rel = relative(base, full);
		if (statSync(full).isDirectory()) {
			walk(base, full, lang, out);
			continue;
		}
		const m = entry.match(LANG_SUFFIX_RE);
		if (m) {
			if (m[2] === lang) {
				// SKILL.zh.md → SKILL.md
				const destRel = relative(base, join(dir, `${m[1]}.md`));
				out.set(destRel, full);
			}
			// other lang → skip
		} else if (!out.has(rel)) {
			// no lang suffix and not already covered
			out.set(rel, full);
		}
	}
}
