import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const EN_DEFAULT_DIRECTORIES = {
	drafts: '00_Drafts',
	diary: '10_Diary',
	projects: '20_Projects',
	research: '30_Research',
	knowledge: '40_Knowledge',
	outputs: '50_Outputs',
	plans: '60_Plans',
	resources: '70_Resources',
	reflection: '80_Reflection',
	system: '90_System',
};
const EN_DEFAULT_SUBDIRECTORIES = {
	knowledge: { notes: 'Notes', wiki: 'Wiki' },
	resources: { books: 'Books', literature: 'Literature', translations: 'Translations' },
	system: {
		templates: 'Templates',
		schema: 'Schema',
		memory: 'Memory',
		digest: 'Digest',
		prompts: 'Prompts',
		archive: {
			projects: 'Archive/Projects',
			drafts: 'Archive/Drafts',
			plans: 'Archive/Plans',
			diary: 'Archive/Diary',
		},
	},
};
const MODIFIABLE_SKILLS = ['ask', 'today', 'digest', 'research', 'translate', 'revise', 'archive'];

function normalizePath(path) {
	return path.split(sep).join('/');
}

function locateAssets(root) {
	if (existsSync(join(root, 'assets'))) return join(root, 'assets');
	if (existsSync(join(root, 'schema'))) return root;
	return null;
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

function isRecord(value) {
	return value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
	return isRecord(value) && sameValue(Object.keys(value).sort(), [...keys].sort());
}

function sameValue(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function isSafeFileName(value) {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function parseDependencyPath(group, requested, locale) {
	const patterns = {
		templates:
			locale === 'zh'
				? /^\{系统目录\}\/\{模板子目录\}\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/
				: /^\{system directory\}\/\{templates subdirectory\}\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/,
		schemas:
			locale === 'zh'
				? /^\{系统目录\}\/\{规范子目录\}\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/
				: /^\{system directory\}\/\{schema subdirectory\}\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/,
		prompts:
			locale === 'zh'
				? /^\{系统目录\}\/\{提示词子目录\}\/$/
				: /^\{system directory\}\/\{prompts subdirectory\}\/$/,
	};
	if (group === 'protocols') return requested === '../_shared/operation-safety.md' ? {} : null;
	if (group === 'agents' || group === 'references') {
		const match = requested.match(/^references\/([A-Za-z0-9][A-Za-z0-9_.-]*)\.md$/);
		return match && isSafeFileName(match[1]) ? { fileName: match[1] } : null;
	}
	const match = patterns[group]?.exec(requested);
	if (!match) return null;
	return match[1] ? { fileName: match[1] } : {};
}

function isValidOperationSafetyContract(contract) {
	const decisions = ['create', 'merge', 'resume', 'skip', 'replace'];
	const captures = [
		'ancestors',
		'leaf_state',
		'leaf_type',
		'leaf_dev',
		'leaf_ino',
		'leaf_realpath',
	];
	const requiredAt = ['before_operation', 'after_operation'];
	const transitions = {
		create_or_update_target: { before: 'missing', after: 'existing' },
		move_source: { before: 'existing', after: 'missing' },
		move_target: { before: 'missing', after: 'existing' },
	};
	const manifest = { run_id: 'string', moves: [], collisions: [], notified: [], errors: [] };
	const contractKeys = [
		'contract_version',
		'preflight',
		'validation',
		'notification',
		'collision',
		'recovery',
		'run_id',
		'target_path',
		'decision',
		'path_guard',
		'manifest',
	];
	if (!hasExactKeys(contract, contractKeys)) return false;
	if (
		contract.contract_version !== 1 ||
		contract.preflight !== 'required' ||
		contract.validation !== 'required' ||
		contract.notification !== 'memory_notify' ||
		contract.collision !== 'preflight_required' ||
		contract.recovery !== 'resume_same_run_id' ||
		contract.run_id !== 'stable(<skill>, <canonical-input>, <time-window-or-mode>)' ||
		contract.target_path !== 'resolved-vault-relative-path' ||
		!sameValue(contract.decision, decisions) ||
		!sameValue(contract.manifest, manifest)
	)
		return false;
	const guard = contract.path_guard;
	if (
		!hasExactKeys(guard, [
			'resolve_scope',
			'create',
			'revalidate',
			'advance',
			'captures',
			'default_leaf_expectation',
			'transitions',
			'required_at',
			'on_change',
			'atomic_race_guarantee',
			'untrusted_concurrency',
		]) ||
		!hasExactKeys(guard.transitions, Object.keys(transitions)) ||
		!Object.values(guard.transitions).every((transition) =>
			hasExactKeys(transition, ['before', 'after']),
		)
	)
		return false;
	return (
		guard.resolve_scope === 'preflight_only' &&
		guard.create === 'createVaultPathGuard' &&
		guard.revalidate === 'revalidateVaultPathGuard' &&
		guard.advance === 'advanceVaultPathGuard' &&
		sameValue(guard.captures, captures) &&
		guard.default_leaf_expectation === 'unchanged' &&
		sameValue(guard.transitions, transitions) &&
		sameValue(guard.required_at, requiredAt) &&
		guard.on_change === 'abort_and_record' &&
		guard.atomic_race_guarantee === false &&
		guard.untrusted_concurrency === 'require_atomic_client_capability'
	);
}

function sameCapabilityContract(left, right, path = '') {
	if (path.endsWith('.purpose') || path.endsWith('.fallback'))
		return typeof left === 'string' && typeof right === 'string';
	if (Array.isArray(left) || Array.isArray(right))
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((item, index) => sameCapabilityContract(item, right[index], `${path}[${index}]`))
		);
	if (left && right && typeof left === 'object' && typeof right === 'object') {
		const leftKeys = Object.keys(left).sort();
		const rightKeys = Object.keys(right).sort();
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every(
				(key, index) =>
					key === rightKeys[index] &&
					sameCapabilityContract(left[key], right[key], path ? `${path}.${key}` : key),
			)
		);
	}
	return left === right;
}

function collectSubdirectoryPaths(directory, value) {
	if (typeof value === 'string') return [`${directory}/${value}`];
	if (!value || typeof value !== 'object') return [];
	return Object.values(value).flatMap((child) => collectSubdirectoryPaths(directory, child));
}

export function englishDefaultPathConfig() {
	return structuredClone({
		directories: EN_DEFAULT_DIRECTORIES,
		subdirectories: EN_DEFAULT_SUBDIRECTORIES,
	});
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
	if (!assets) {
		return {
			ok: false,
			diagnostics: [
				{ code: 'missing_assets_root', path: '.', message: `找不到 assets 目录：${absoluteRoot}` },
			],
		};
	}
	const diagnostics = [];
	const add = (code, path, message, relatedPath) => {
		const diagnostic = { code, path, message };
		if (relatedPath) diagnostic.related_path = relatedPath;
		diagnostics.push(diagnostic);
	};
	const assetPath = (path) => relativeAssetPath(absoluteRoot, path);
	const skillRoot = join(assets, 'skills');
	const templateRoot = join(assets, 'templates');
	const zhConfig = existsSync(join(assets, 'lifeos.yaml'))
		? parseYaml(read(join(assets, 'lifeos.yaml')))
		: { directories: {} };
	const zhDirectories = Object.values(zhConfig?.directories ?? {}).length
		? Object.values(zhConfig.directories)
		: [
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
	const zhSubdirectories = Object.entries(zhConfig?.subdirectories ?? {}).flatMap(([key, value]) =>
		typeof zhConfig?.directories?.[key] === 'string'
			? collectSubdirectoryPaths(zhConfig.directories[key], value)
			: [],
	);
	const enSubdirectories = Object.entries(EN_DEFAULT_SUBDIRECTORIES).flatMap(([key, value]) =>
		collectSubdirectoryPaths(EN_DEFAULT_DIRECTORIES[key], value),
	);
	const defaultPhysicalPaths = new Set([
		...zhDirectories,
		...zhSubdirectories,
		...Object.values(EN_DEFAULT_DIRECTORIES),
		...enSubdirectories,
	]);
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

	for (const path of walkFiles(templateRoot).filter((candidate) => candidate.endsWith('.md'))) {
		const { frontmatter } = readMarkdown(path);
		if (!frontmatter) continue;
		const type = frontmatter.type;
		if (typeof type !== 'string' || !Object.hasOwn(types, type)) {
			add('unknown_generated_type', assetPath(path), `模板 type 未定义于 Schema：${String(type)}`);
		} else if (types[type]?.template !== basename(path)) {
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
	if (
		!capabilitiesZh ||
		!capabilitiesEn ||
		!sameCapabilityContract(capabilitiesZh, capabilitiesEn)
	) {
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
		const locale = path.endsWith('.zh.md') ? 'zh' : 'en';
		for (const group of ['templates', 'schemas', 'agents', 'references', 'prompts', 'protocols']) {
			for (const dependency of dependencies[group] ?? []) {
				const requested = typeof dependency === 'string' ? dependency : dependency?.path;
				if (typeof requested !== 'string') continue;
				const parsed = parseDependencyPath(group, requested, locale);
				if (!parsed || (group === 'prompts' && dependency?.scan !== true)) {
					add(
						'invalid_dependency_path',
						assetPath(path),
						`依赖路径不符合 ${group} 语法：${requested}`,
					);
					continue;
				}
				let candidates = [];
				if (group === 'templates') candidates = [join(templateRoot, locale, parsed.fileName)];
				else if (group === 'schemas') candidates = [join(assets, 'schema', parsed.fileName)];
				else if (group === 'protocols')
					candidates = [join(skillDirectory, `../_shared/operation-safety.${locale}.md`)];
				else if (group === 'prompts') candidates = [join(assets, 'prompts')];
				else candidates = [join(skillDirectory, 'references', `${parsed.fileName}.${locale}.md`)];
				for (const candidate of candidates) {
					if (!existsSync(candidate))
						add(
							'missing_dependency',
							assetPath(path),
							`依赖不存在：${requested}`,
							assetPath(candidate),
						);
				}
				if (group === 'agents') {
					const existing = candidates.filter(existsSync);
					for (const agentPath of existing) {
						const expected = Array.isArray(dependency?.placeholders)
							? [...dependency.placeholders].sort()
							: [];
						const actual = extractPlaceholders(read(agentPath));
						const invocation =
							typeof dependency?.invocation === 'string'
								? extractPlaceholders(dependency.invocation)
								: [];
						if (
							JSON.stringify(expected) !== JSON.stringify(actual) ||
							JSON.stringify(expected) !== JSON.stringify(invocation)
						) {
							add(
								'placeholder_mismatch',
								assetPath(path),
								`Agent 调用声明与提示词占位符不一致：${requested}`,
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

	for (const path of walkFiles(assets)) {
		if (!/\.(md|py|mjs)$/.test(path)) continue;
		if (path.endsWith('lifeos.yaml') || path.includes('lifeos-rules')) continue;
		const content = read(path);
		for (const directory of defaultPhysicalPaths) {
			if (content.includes(directory))
				add('hardcoded_logical_path', assetPath(path), `不得写死默认逻辑目录：${directory}`);
		}
	}

	const safetyContracts = [];
	const safetyValid = [];
	for (const locale of ['zh', 'en']) {
		const path = join(skillRoot, '_shared', `operation-safety.${locale}.md`);
		const contract = existsSync(path) ? readMarkedYaml(path, 'operation-safety-v1') : null;
		const valid = isValidOperationSafetyContract(contract);
		if (!valid) {
			add('invalid_operation_safety_contract', assetPath(path), '操作安全机器契约字段或值非法');
		}
		safetyContracts.push(contract);
		safetyValid.push(valid);
	}
	if (
		safetyValid[0] &&
		safetyValid[1] &&
		safetyContracts[0] &&
		safetyContracts[1] &&
		JSON.stringify(safetyContracts[0]) !== JSON.stringify(safetyContracts[1])
	)
		add(
			'invalid_operation_safety_contract',
			assetPath(join(skillRoot, '_shared', 'operation-safety.zh.md')),
			'中英文操作安全机器契约不一致',
			assetPath(join(skillRoot, '_shared', 'operation-safety.en.md')),
		);

	for (const skill of MODIFIABLE_SKILLS) {
		for (const locale of ['zh', 'en']) {
			const path = join(skillRoot, skill, `SKILL.${locale}.md`);
			if (!existsSync(path)) continue;
			const { frontmatter } = readMarkdown(path);
			const protocols = frontmatter?.dependencies?.protocols ?? [];
			if (!protocols.length)
				add(
					'missing_operation_safety_reference',
					assetPath(path),
					'修改型技能必须在 Frontmatter protocols 声明 operation-safety',
				);
			const operation = readMarkedYaml(path, 'operation-safety-v1');
			if (!operation || operation.safety_protocol !== 'operation-safety-v1')
				add(
					'missing_operation_safety_reference',
					assetPath(path),
					'修改型技能必须结构化引用 operation-safety-v1',
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
