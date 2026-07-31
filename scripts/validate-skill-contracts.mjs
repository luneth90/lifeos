import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_LOGICAL_DIRECTORIES = [
	'00_草稿',
	'10_日记',
	'20_项目',
	'30_研究',
	'40_知识',
	'50_成果',
	'60_计划',
	'70_资源',
	'80_复盘',
	'90_系统',
];
const MODIFIABLE_SKILLS = ['ask', 'today', 'digest', 'research', 'translate', 'revise', 'archive'];

function normalizePath(path) {
	return path.split(sep).join('/');
}

function locateAssets(root) {
	if (existsSync(join(root, 'assets'))) return join(root, 'assets');
	if (existsSync(join(root, 'schema'))) return root;
	throw new Error(`找不到 assets 目录：${root}`);
}

function walkFiles(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? walkFiles(path) : [path];
	});
}

function read(path) {
	return readFileSync(path, 'utf8');
}

function relativeAssetPath(root, path) {
	return normalizePath(relative(root, path));
}

function readMarkdown(path) {
	const content = read(path);
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { frontmatter: null, body: content };
	const parsed = parseYaml(match[1]);
	return {
		frontmatter: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null,
		body: match[2],
	};
}

function readMarkedYaml(path, marker) {
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = read(path).match(
		new RegExp(`<!--\\s*${escaped}\\s*-->\\s*\\n\`\`\`yaml\\n([\\s\\S]*?)\\n\`\`\``),
	);
	if (!match) return null;
	const parsed = parseYaml(match[1]);
	return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function extractPlaceholders(content) {
	return [
		...new Set([...content.matchAll(/\{\{\s*[^{}]+?\s*\}\}/g)].map((match) => match[0])),
	].sort();
}

function sameShape(left, right) {
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((item, index) => sameShape(item, right[index]))
		);
	}
	if (left && right && typeof left === 'object' && typeof right === 'object') {
		const leftKeys = Object.keys(left).sort();
		const rightKeys = Object.keys(right).sort();
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every((key, index) => key === rightKeys[index] && sameShape(left[key], right[key]))
		);
	}
	return typeof left === typeof right;
}

function yamlFences(content) {
	return [...content.matchAll(/```yaml\n([\s\S]*?)\n```/g)]
		.map((match) => {
			try {
				return parseYaml(match[1]);
			} catch {
				return null;
			}
		})
		.filter((value) => value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * 检查 LifeOS 源码 assets 的跨文件技能契约。
 * @param {string} root 仓库根目录，或直接包含 schema/ 的 assets 目录。
 * @returns {{ok: boolean, diagnostics: Array<{code: string, path: string, related_path?: string, message: string}>}}
 */
export function validateSkillContracts(root) {
	const absoluteRoot = join(root);
	const assets = locateAssets(absoluteRoot);
	const diagnostics = [];
	const add = (code, path, message, relatedPath) => {
		const diagnostic = { code, path, message };
		if (relatedPath) diagnostic.related_path = relatedPath;
		diagnostics.push(diagnostic);
	};
	const assetPath = (path) => relativeAssetPath(absoluteRoot, path);
	const skillRoot = join(assets, 'skills');
	const templateRoot = join(assets, 'templates');
	const markdownFiles = walkFiles(assets).filter((path) => path.endsWith('.md'));
	const jsonFiles = walkFiles(assets).filter((path) => path.endsWith('.json'));

	for (const path of jsonFiles) {
		try {
			JSON.parse(read(path));
		} catch {
			add('invalid_schema_json', assetPath(path), 'JSON Schema 无法解析');
		}
	}

	for (const path of markdownFiles) {
		if (path.includes(`${sep}templates${sep}`)) continue;
		if (path.endsWith('.zh.md')) {
			const counterpart = path.replace(/\.zh\.md$/, '.en.md');
			if (!existsSync(counterpart))
				add('missing_locale_pair', assetPath(path), '缺少英文对应文件', assetPath(counterpart));
		}
		if (path.endsWith('.en.md')) {
			const counterpart = path.replace(/\.en\.md$/, '.zh.md');
			if (!existsSync(counterpart))
				add('missing_locale_pair', assetPath(path), '缺少中文对应文件', assetPath(counterpart));
		}
	}
	for (const locale of ['zh', 'en']) {
		const counterpart = locale === 'zh' ? 'en' : 'zh';
		for (const path of walkFiles(join(templateRoot, locale)).filter((candidate) =>
			candidate.endsWith('.md'),
		)) {
			const expected = join(templateRoot, counterpart, basename(path));
			if (!existsSync(expected))
				add(
					'missing_locale_pair',
					assetPath(path),
					`缺少 ${counterpart} 模板对应文件`,
					assetPath(expected),
				);
		}
	}

	const schemaPath = join(assets, 'schema', 'Frontmatter_Schema.md');
	const schema = existsSync(schemaPath)
		? readMarkedYaml(schemaPath, 'frontmatter-contract-v1')
		: null;
	const types = schema?.types && typeof schema.types === 'object' ? schema.types : {};
	const knownTypes = new Set([...Object.keys(types), 'project-doc', 'wiki', 'note', 'system']);

	for (const path of walkFiles(templateRoot).filter((candidate) => candidate.endsWith('.md'))) {
		const { frontmatter } = readMarkdown(path);
		if (!frontmatter) continue;
		const type = frontmatter.type;
		if (typeof type !== 'string' || !knownTypes.has(type)) {
			add('unknown_generated_type', assetPath(path), `模板 type 未定义于 Schema：${String(type)}`);
		} else if (types[type]?.template && types[type].template !== basename(path)) {
			add('unknown_generated_type', assetPath(path), `模板与 Schema 映射不一致：${type}`);
		}
		if (frontmatter.id !== '{{ID}}')
			add('invalid_template_id', assetPath(path), '模板 id 必须是 {{ID}}');
		if (
			typeof frontmatter.status === 'string' &&
			Array.isArray(types[type]?.statuses) &&
			!types[type].statuses.includes(frontmatter.status)
		) {
			add(
				'invalid_lifecycle_transition',
				assetPath(path),
				`模板 status 不属于 ${type} 生命周期：${frontmatter.status}`,
			);
		}
	}
	for (const [type, definition] of Object.entries(types)) {
		if (!definition || typeof definition !== 'object' || !definition.template) continue;
		for (const locale of ['zh', 'en']) {
			const templatePath = join(templateRoot, locale, definition.template);
			if (!existsSync(templatePath))
				add(
					'missing_dependency',
					assetPath(schemaPath),
					`${type} 缺少 ${locale} 模板：${definition.template}`,
					assetPath(templatePath),
				);
		}
	}

	const capabilitiesZhPath = join(skillRoot, '_shared', 'client-capabilities.zh.md');
	const capabilitiesEnPath = join(skillRoot, '_shared', 'client-capabilities.en.md');
	const capabilitiesZh = existsSync(capabilitiesZhPath)
		? readMarkedYaml(capabilitiesZhPath, 'client-capabilities-v1')
		: null;
	const capabilitiesEn = existsSync(capabilitiesEnPath)
		? readMarkedYaml(capabilitiesEnPath, 'client-capabilities-v1')
		: null;
	if (!capabilitiesZh || !capabilitiesEn || !sameShape(capabilitiesZh, capabilitiesEn)) {
		add(
			'capability_contract_mismatch',
			assetPath(capabilitiesZhPath),
			'中英文能力契约的机器字段、字段类型或结构不一致',
			assetPath(capabilitiesEnPath),
		);
	}
	const declaredCapabilities = new Set(
		capabilitiesZh?.capabilities && typeof capabilitiesZh.capabilities === 'object'
			? Object.keys(capabilitiesZh.capabilities)
			: [],
	);

	for (const path of walkFiles(skillRoot).filter((candidate) =>
		/\/SKILL\.(zh|en)\.md$/.test(candidate),
	)) {
		const { frontmatter, body } = readMarkdown(path);
		if (!frontmatter) continue;
		const dependencies =
			frontmatter.dependencies && typeof frontmatter.dependencies === 'object'
				? frontmatter.dependencies
				: {};
		for (const capability of dependencies.capabilities ?? []) {
			if (typeof capability !== 'string' || !declaredCapabilities.has(capability)) {
				add('undeclared_capability', assetPath(path), `未在能力协议声明：${String(capability)}`);
			}
		}
		for (const capability of declaredCapabilities) {
			if (
				new RegExp(`\\b${capability}\\b`).test(body) &&
				!(dependencies.capabilities ?? []).includes(capability)
			) {
				add(
					'undeclared_capability',
					assetPath(path),
					`使用能力但 dependencies.capabilities 未声明：${capability}`,
				);
			}
		}
		const skillDirectory = join(path, '..');
		for (const group of ['templates', 'schemas', 'agents', 'references']) {
			for (const dependency of dependencies[group] ?? []) {
				const requested = typeof dependency === 'string' ? dependency : dependency?.path;
				if (typeof requested !== 'string') continue;
				let candidates = [];
				if (group === 'templates') {
					candidates = ['zh', 'en'].map((locale) =>
						join(templateRoot, locale, basename(requested)),
					);
				} else if (group === 'schemas') {
					candidates = [join(assets, 'schema', basename(requested))];
				} else if (requested.startsWith('references/')) {
					candidates = ['zh', 'en'].map((locale) =>
						join(skillDirectory, requested.replace(/\.md$/, `.${locale}.md`)),
					);
				} else {
					candidates = [join(skillDirectory, requested)];
				}
				for (const candidate of candidates) {
					if (!existsSync(candidate))
						add(
							'missing_dependency',
							assetPath(path),
							`依赖不存在：${requested}`,
							assetPath(candidate),
						);
				}
				if (group === 'agents' && requested.startsWith('references/')) {
					const existing = candidates.filter(existsSync);
					for (const agentPath of existing) {
						const expected = extractPlaceholders(body);
						const actual = extractPlaceholders(read(agentPath));
						if (JSON.stringify(expected) !== JSON.stringify(actual)) {
							add(
								'placeholder_mismatch',
								assetPath(path),
								`调用方与提示词占位符不一致：${requested}`,
								assetPath(agentPath),
							);
						}
					}
				}
			}
		}
		for (const document of yamlFences(body)) {
			if (typeof document.type !== 'string' || typeof document.status !== 'string') continue;
			if (
				!Array.isArray(types[document.type]?.statuses) ||
				!types[document.type].statuses.includes(document.status)
			) {
				add(
					'invalid_lifecycle_transition',
					assetPath(path),
					`非法状态：${document.type} / ${document.status}`,
				);
			}
		}
	}

	for (const path of walkFiles(skillRoot)) {
		if (!/\.(md|py|mjs)$/.test(path)) continue;
		const content = read(path);
		for (const directory of DEFAULT_LOGICAL_DIRECTORIES) {
			if (content.includes(directory))
				add('hardcoded_logical_path', assetPath(path), `不得写死默认逻辑目录：${directory}`);
		}
	}

	for (const skill of MODIFIABLE_SKILLS) {
		for (const locale of ['zh', 'en']) {
			const path = join(skillRoot, skill, `SKILL.${locale}.md`);
			if (existsSync(path) && !read(path).includes('operation-safety')) {
				add(
					'missing_operation_safety',
					assetPath(path),
					'修改型流程必须声明 operation-safety 协议',
				);
			}
		}
	}
	for (const locale of ['zh', 'en']) {
		const path = join(skillRoot, '_shared', `operation-safety.${locale}.md`);
		const content = existsSync(path) ? read(path) : '';
		const terms =
			locale === 'zh'
				? ['preflight', '校验', 'memory_notify', 'collision', '恢复']
				: ['preflight', 'validation', 'memory_notify', 'collision', 'recovery'];
		if (!terms.every((term) => content.includes(term))) {
			add(
				'missing_operation_safety',
				assetPath(path),
				'操作安全协议必须包含预检、校验、通知、冲突与恢复语义',
			);
		}
	}

	diagnostics.sort((left, right) =>
		`${left.path}\u0000${left.code}\u0000${left.related_path ?? ''}`.localeCompare(
			`${right.path}\u0000${right.code}\u0000${right.related_path ?? ''}`,
		),
	);
	return { ok: diagnostics.length === 0, diagnostics };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = process.argv[2] ?? repositoryRoot;
	const result = validateSkillContracts(root);
	if (result.ok) {
		console.log('技能契约校验通过');
	} else {
		for (const diagnostic of result.diagnostics) console.error(JSON.stringify(diagnostic));
		process.exitCode = 1;
	}
}
