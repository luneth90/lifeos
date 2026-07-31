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
const MODIFIABLE_SKILLS = [
	'ask',
	'today',
	'digest',
	'research',
	'translate',
	'revise',
	'archive',
	'project',
	'knowledge',
	'brainstorm',
];
const EXTENDED_WRITE_SKILLS = new Set(['project', 'knowledge', 'brainstorm']);
const ARCHIVE_TARGET_KEYS = ['project-file', 'project-directory', 'draft', 'plan', 'diary'];
const TEMPLATE_LOCALIZED_FRONTMATTER_FIELDS = {
	'Revise_Template.md': new Set(['note']),
};
const RESOURCE_SUBDIRECTORY_CONFIG_KEYS = new Set([
	'subdirectories.resources.books',
	'subdirectories.resources.literature',
	'subdirectories.resources.translations',
]);

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

function readMarkdown(path, onYamlError) {
	const content = read(path);
	const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { frontmatter: null, body: content, frontmatter_state: 'missing' };
	let parsed;
	try {
		parsed = parseYaml(match[1]);
	} catch {
		onYamlError?.();
		return { frontmatter: null, body: match[2], frontmatter_state: 'invalid_yaml' };
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { frontmatter: null, body: match[2], frontmatter_state: 'non_object' };
	}
	return {
		frontmatter: parsed,
		body: match[2],
		frontmatter_state: 'valid',
	};
}

function readMarkedYaml(path, marker, onYamlError) {
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = read(path).match(
		new RegExp(`<!--\\s*${escaped}\\s*-->\\s*\\n\`\`\`yaml\\n([\\s\\S]*?)\\n\`\`\``),
	);
	if (!match) return { found: false, invalid: false, value: null };
	try {
		const parsed = parseYaml(match[1]);
		return {
			found: true,
			invalid: false,
			value: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null,
		};
	} catch {
		onYamlError?.();
		return { found: true, invalid: true, value: null };
	}
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

function structuredGeneratedDocuments(content) {
	const documents = [];
	for (const match of content.matchAll(/```(yaml|markdown)\n([\s\S]*?)\n```/g)) {
		let source = match[2];
		if (match[1] === 'markdown') {
			const frontmatter = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
			if (!frontmatter) continue;
			source = frontmatter[1];
		} else {
			const fencedFrontmatter = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
			if (fencedFrontmatter) source = fencedFrontmatter[1];
		}
		try {
			const parsed = parseYaml(source);
			if (isRecord(parsed)) documents.push(parsed);
		} catch {
			// 标记契约由 readMarkedYaml 产生稳定诊断；其他示例只是不参与生成类型扫描。
		}
	}
	return documents;
}

function declaredPathPlaceholders(body) {
	return new Map(
		[...body.matchAll(/`(\{[^{}\n]+\})`\s*(?:→|->)\s*([A-Za-z0-9_.-]+)/g)].map((match) => [
			match[1],
			match[2],
		]),
	);
}

function configStringAtPath(config, path) {
	let current = config;
	for (const segment of path.split('.')) {
		if (!isRecord(current) || !Object.hasOwn(current, segment)) return null;
		current = current[segment];
	}
	return typeof current === 'string' ? current : null;
}

function resourceChildPlaceholders(content, locale) {
	const parent = locale === 'zh' ? '{资源目录}' : '{resources directory}';
	const escaped = parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new Set(
		[...content.matchAll(new RegExp(`${escaped}/(\\{[^{}\\n/]+\\})`, 'g'))].map(
			(match) => match[1],
		),
	);
}

function isNormalizableTarget(target) {
	if (typeof target !== 'string' || !target || target !== target.normalize('NFC')) return false;
	if (
		target.startsWith('/') ||
		/^[A-Za-z]:[\\/]/.test(target) ||
		target.includes('\\') ||
		target.includes('//') ||
		target.includes('...') ||
		[...target].some((character) => {
			const code = character.charCodeAt(0);
			return code <= 31 || code === 127;
		})
	)
		return false;
	const segments = target.split('/').filter(Boolean);
	if (!segments.length || segments.some((segment) => segment === '.' || segment === '..'))
		return false;
	const withoutTokens = target.replace(/\{[^{}\n]+\}/g, '').replace(/<[^<>/\n]+>/g, '');
	return !/[{}<>]/.test(withoutTokens);
}

function operationTargetEntries(contract) {
	if (typeof contract?.target_path === 'string') return [['target_path', contract.target_path]];
	if (isRecord(contract?.target_paths)) return Object.entries(contract.target_paths);
	return [];
}

function uniqueOutputPath(body, locale) {
	const heading = locale === 'zh' ? '### 产出路径' : '### Output Path';
	const start = body.indexOf(heading);
	if (start < 0) return null;
	const match = body.slice(start + heading.length).match(/^\s*```(?:text)?\n([^\n]+)\n```/);
	return match?.[1]?.trim() ?? null;
}

function expectedTranslateContract(locale) {
	if (locale === 'zh') {
		return {
			resource_placeholder: '{资源目录}',
			translations_placeholder: '{翻译子目录}',
			target_path: '{资源目录}/{翻译子目录}/<书名>/<章节名>.md',
		};
	}
	return {
		resource_placeholder: '{resources directory}',
		translations_placeholder: '{translations subdirectory}',
		target_path: '{resources directory}/{translations subdirectory}/<book-name>/<chapter-name>.md',
	};
}

function expectedArchiveContract(locale) {
	const zh = locale === 'zh';
	const system = zh ? '{系统目录}' : '{system directory}';
	const placeholders = {
		projects: zh ? '{归档项目子目录}' : '{archived projects subdirectory}',
		drafts: zh ? '{归档草稿子目录}' : '{archived drafts subdirectory}',
		plans: zh ? '{归档计划子目录}' : '{archived plans subdirectory}',
		diary: zh ? '{归档日记子目录}' : '{archived diary subdirectory}',
	};
	return {
		system,
		placeholders,
		mapping_keys: {
			projects: 'subdirectories.system.archive.projects',
			drafts: 'subdirectories.system.archive.drafts',
			plans: 'subdirectories.system.archive.plans',
			diary: 'subdirectories.system.archive.diary',
		},
		target_paths: {
			'project-file': `${system}/${placeholders.projects}/YYYY/<project-name>.md`,
			'project-directory': `${system}/${placeholders.projects}/YYYY/<project-name>/`,
			draft: `${system}/${placeholders.drafts}/YYYY/MM/<filename>.md`,
			plan: `${system}/${placeholders.plans}/<filename>.md`,
			diary: `${system}/${placeholders.diary}/YYYY/MM/YYYY-MM-DD.md`,
		},
		documented_paths: {
			'project-file': `${system}/${placeholders.projects}/YYYY/ProjectName.md`,
			'project-directory': `${system}/${placeholders.projects}/YYYY/ProjectName/`,
			draft: `${system}/${placeholders.drafts}/YYYY/MM/filename.md`,
			plan: `${system}/${placeholders.plans}/Plan_YYYY-MM-DD_Type_Name.md`,
			diary: `${system}/${placeholders.diary}/YYYY/MM/YYYY-MM-DD.md`,
		},
		target_mapping_groups: {
			'project-file': 'projects',
			'project-directory': 'projects',
			draft: 'drafts',
			plan: 'plans',
			diary: 'diary',
		},
	};
}

function expectedKnowledgeTargets(locale) {
	if (locale === 'zh') {
		return {
			'book-knowledge-note':
				'{知识目录}/{笔记子目录}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md',
			'paper-knowledge-note': '{知识目录}/{笔记子目录}/<Domain>/<PaperName>.md',
			wiki: '{知识目录}/{百科子目录}/<Domain>/<ConceptName>.md',
		};
	}
	return {
		'book-knowledge-note':
			'{knowledge directory}/{notes subdirectory}/<Domain>/<BookName>/<ChapterName>/<ChapterName>.md',
		'paper-knowledge-note': '{knowledge directory}/{notes subdirectory}/<Domain>/<PaperName>.md',
		wiki: '{knowledge directory}/{wiki subdirectory}/<Domain>/<ConceptName>.md',
	};
}

function normalizedLocalizedTemplateField(name, key, value, locale) {
	if (name !== 'Revise_Template.md' || key !== 'note' || typeof value !== 'string') return null;
	const match = /^\[\[([^\[\]|#]+)\]\]$/.exec(value.trim());
	if (!match) return null;
	const expected = locale === 'zh' ? '知识笔记路径' : 'Knowledge note path';
	return match[1].trim() === expected ? 'knowledge-note-path' : null;
}

function isValidExtendedWriteContract(contract) {
	return (
		hasExactKeys(contract?.guard, ['artifacts', 'status_targets']) &&
		contract.guard.artifacts === 'create_or_update_target' &&
		contract.guard.status_targets === 'unchanged_until_validated' &&
		hasExactKeys(contract?.manifest, ['records', 'commit_order']) &&
		sameValue(contract.manifest.records, [
			'artifacts',
			'status_mutations',
			'validation',
			'notified',
			'errors',
		]) &&
		sameValue(contract.manifest.commit_order, [
			'guard',
			'write',
			'validate',
			'memory_notify',
			'mutate_status',
		]) &&
		hasExactKeys(contract?.recovery, [
			'strategy',
			'preserve_sources_on_failure',
			'atomic_cross_system_guarantee',
		]) &&
		contract.recovery.strategy === 'resume_same_run_id' &&
		contract.recovery.preserve_sources_on_failure === true &&
		contract.recovery.atomic_cross_system_guarantee === false &&
		Array.isArray(contract?.status_mutations)
	);
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
	const markdownCache = new Map();
	const markdown = (path) => {
		if (!markdownCache.has(path)) {
			markdownCache.set(
				path,
				readMarkdown(path, () =>
					add(
						'invalid_markdown_frontmatter_yaml',
						assetPath(path),
						'Markdown Frontmatter YAML 无法解析',
					),
				),
			);
		}
		return markdownCache.get(path);
	};
	const markedYamlCache = new Map();
	const markedYaml = (path, marker) => {
		const key = `${path}\u0000${marker}`;
		if (!markedYamlCache.has(key)) {
			markedYamlCache.set(
				key,
				readMarkedYaml(path, marker, () =>
					add('invalid_marked_yaml', assetPath(path), `标记 YAML 契约无法解析：${marker}`),
				),
			);
		}
		return markedYamlCache.get(key);
	};
	const configPath = join(assets, 'lifeos.yaml');
	let zhConfig = { directories: {} };
	let authoritativePathConfig = null;
	if (existsSync(configPath)) {
		try {
			const parsed = parseYaml(read(configPath));
			if (isRecord(parsed)) {
				zhConfig = parsed;
				authoritativePathConfig = parsed;
			}
		} catch {
			add('invalid_lifeos_yaml', assetPath(configPath), 'lifeos.yaml 无法解析');
		}
	}
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
	for (const path of markdownFiles) markdown(path);

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
	const schemaResult = existsSync(schemaPath)
		? markedYaml(schemaPath, 'frontmatter-contract-v1')
		: { found: false, invalid: false, value: null };
	const schema = schemaResult.value;
	const types = schema?.types && typeof schema.types === 'object' ? schema.types : {};

	for (const path of walkFiles(templateRoot).filter((candidate) => candidate.endsWith('.md'))) {
		const { frontmatter, frontmatter_state: state } = markdown(path);
		if (state === 'missing') {
			add('missing_template_frontmatter', assetPath(path), '模板缺少 Frontmatter');
			continue;
		}
		if (state === 'non_object') {
			add('invalid_template_frontmatter', assetPath(path), '模板 Frontmatter 必须是对象');
			continue;
		}
		if (!frontmatter) continue;
		const type = frontmatter.type;
		if (!schemaResult.invalid && (typeof type !== 'string' || !Object.hasOwn(types, type))) {
			add('unknown_generated_type', assetPath(path), `模板 type 未定义于 Schema：${String(type)}`);
		} else if (!schemaResult.invalid && types[type]?.template !== basename(path)) {
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
	for (const name of walkFiles(join(templateRoot, 'zh'))
		.map((path) => basename(path))
		.sort()) {
		const zhPath = join(templateRoot, 'zh', name);
		const enPath = join(templateRoot, 'en', name);
		if (!existsSync(enPath)) continue;
		const zh = markdown(zhPath);
		const en = markdown(enPath);
		if (!zh.frontmatter || !en.frontmatter) continue;
		const localized = TEMPLATE_LOCALIZED_FRONTMATTER_FIELDS[name] ?? new Set();
		for (const key of [
			...new Set([...Object.keys(zh.frontmatter), ...Object.keys(en.frontmatter)]),
		].sort()) {
			if (localized.has(key)) {
				const zhNormalized = normalizedLocalizedTemplateField(name, key, zh.frontmatter[key], 'zh');
				const enNormalized = normalizedLocalizedTemplateField(name, key, en.frontmatter[key], 'en');
				if (!zhNormalized || zhNormalized !== enNormalized) {
					add(
						'invalid_localized_template_frontmatter',
						assetPath(enPath),
						`中英文模板 Frontmatter 本地化字段结构或占位语义不一致：${key}`,
						assetPath(zhPath),
					);
				}
				continue;
			}
			if (!sameValue(zh.frontmatter[key], en.frontmatter[key])) {
				add(
					'template_frontmatter_mismatch',
					assetPath(enPath),
					`中英文模板 Frontmatter 机器字段不一致：${key}`,
					assetPath(zhPath),
				);
			}
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
	const capabilitiesZhResult = existsSync(capabilitiesZhPath)
		? markedYaml(capabilitiesZhPath, 'client-capabilities-v1')
		: { found: false, invalid: false, value: null };
	const capabilitiesEnResult = existsSync(capabilitiesEnPath)
		? markedYaml(capabilitiesEnPath, 'client-capabilities-v1')
		: { found: false, invalid: false, value: null };
	const capabilitiesZh = capabilitiesZhResult.value;
	const capabilitiesEn = capabilitiesEnResult.value;
	if (
		!capabilitiesZhResult.invalid &&
		!capabilitiesEnResult.invalid &&
		(!capabilitiesZh || !capabilitiesEn || !sameCapabilityContract(capabilitiesZh, capabilitiesEn))
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
		const { frontmatter, body } = markdown(path);
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
	}
	if (!schemaResult.invalid) {
		for (const path of walkFiles(skillRoot).filter((candidate) => candidate.endsWith('.md'))) {
			for (const document of structuredGeneratedDocuments(read(path))) {
				if (typeof document.type !== 'string') continue;
				if (!Object.hasOwn(types, document.type)) {
					add(
						'unknown_generated_type',
						assetPath(path),
						`结构化生成 type 未定义于 Schema：${document.type}`,
					);
					continue;
				}
				if (
					typeof document.status === 'string' &&
					(!Array.isArray(types[document.type]?.statuses) ||
						!types[document.type].statuses.includes(document.status))
				) {
					add(
						'invalid_lifecycle_transition',
						assetPath(path),
						`非法状态：${document.type} / ${document.status}`,
					);
				}
			}
		}
	}

	if (authoritativePathConfig) {
		for (const entry of readdirSync(skillRoot, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name === '_shared') continue;
			const skillDirectory = join(skillRoot, entry.name);
			for (const locale of ['zh', 'en']) {
				const skillPath = join(skillDirectory, `SKILL.${locale}.md`);
				if (!existsSync(skillPath)) continue;
				const { body, frontmatter_state: state } = markdown(skillPath);
				if (state === 'invalid_yaml') continue;
				const mappings = declaredPathPlaceholders(body);
				const invalidMappings = new Set();
				for (const [placeholder, configKey] of mappings) {
					if (configStringAtPath(authoritativePathConfig, configKey) !== null) continue;
					invalidMappings.add(placeholder);
					add(
						'invalid_path_mapping',
						assetPath(skillPath),
						`逻辑路径映射未解析到 lifeos.yaml 权威配置键：${placeholder}`,
					);
				}
				const resourceParent = locale === 'zh' ? '{资源目录}' : '{resources directory}';
				for (const path of walkFiles(skillDirectory).filter((candidate) =>
					candidate.endsWith(`.${locale}.md`),
				)) {
					const children = resourceChildPlaceholders(read(path), locale);
					if (!children.size) continue;
					if (mappings.get(resourceParent) !== 'directories.resources') {
						add(
							'invalid_resource_path_mapping',
							assetPath(path),
							`逻辑资源父目录必须映射到 directories.resources：${resourceParent}`,
						);
					}
					for (const child of children) {
						const configKey = mappings.get(child);
						if (!configKey) {
							add(
								'invalid_resource_path_mapping',
								assetPath(path),
								`逻辑资源子目录占位符未声明：${child}`,
							);
							continue;
						}
						if (invalidMappings.has(child)) continue;
						if (!RESOURCE_SUBDIRECTORY_CONFIG_KEYS.has(configKey)) {
							add(
								'invalid_resource_path_mapping',
								assetPath(path),
								`逻辑资源子目录必须映射到 books、literature 或 translations：${child}`,
							);
						}
					}
				}
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
		for (const token of ['{资源目录}', '{resources directory}']) {
			const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const pattern = new RegExp(`${escaped}/(?!\\{)([^/\\s\`|)\\]\\}]+)`, 'g');
			const fixedChildren = new Set([...content.matchAll(pattern)].map((match) => match[1]));
			for (const child of fixedChildren) {
				add(
					'hardcoded_logical_path',
					assetPath(path),
					`逻辑资源目录后不得使用固定子目录：${child}`,
				);
			}
		}
	}

	const safetyContracts = [];
	const safetyValid = [];
	for (const locale of ['zh', 'en']) {
		const path = join(skillRoot, '_shared', `operation-safety.${locale}.md`);
		const result = existsSync(path)
			? markedYaml(path, 'operation-safety-v1')
			: { found: false, invalid: false, value: null };
		const contract = result.value;
		const valid = !result.invalid && isValidOperationSafetyContract(contract);
		if (!result.invalid && !valid) {
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
			const { frontmatter, body, frontmatter_state: state } = markdown(path);
			if (state === 'invalid_yaml') continue;
			const protocols = frontmatter?.dependencies?.protocols ?? [];
			if (!protocols.length)
				add(
					'missing_operation_safety_reference',
					assetPath(path),
					'修改型技能必须在 Frontmatter protocols 声明 operation-safety',
				);
			const operationResult = markedYaml(path, 'operation-safety-v1');
			const operation = operationResult.value;
			if (
				!operationResult.invalid &&
				(!operation || operation.safety_protocol !== 'operation-safety-v1')
			)
				add(
					'missing_operation_safety_reference',
					assetPath(path),
					'修改型技能必须结构化引用 operation-safety-v1',
				);
			if (!operation || operationResult.invalid) continue;
			if (
				operation.contract_version !== 1 ||
				operation.operation !== skill ||
				typeof operation.run_id !== 'string' ||
				!operation.run_id.startsWith(`stable(${skill},`) ||
				!sameValue(operation.decision, ['create', 'merge', 'resume', 'skip', 'replace'])
			) {
				add(
					'invalid_skill_operation_contract',
					assetPath(path),
					'技能级操作契约的版本、操作名、run_id 或 decision 非法',
				);
			}
			if (skill === 'archive') {
				if (
					!isRecord(operation.target_paths) ||
					!hasExactKeys(operation.target_paths, ARCHIVE_TARGET_KEYS) ||
					Object.hasOwn(operation, 'target_path')
				) {
					add(
						'invalid_archive_target_map',
						assetPath(path),
						'Archive 必须完整声明 project-file、project-directory、draft、plan、diary 目标映射',
					);
					continue;
				}
				const expected = expectedArchiveContract(locale);
				const mappings = declaredPathPlaceholders(body);
				const documentedBody = body.split('<!-- operation-safety-v1 -->')[0];
				for (const key of ARCHIVE_TARGET_KEYS) {
					const group = expected.target_mapping_groups[key];
					if (
						operation.target_paths[key] !== expected.target_paths[key] ||
						!documentedBody.includes(`\`${expected.documented_paths[key]}\``) ||
						mappings.get(expected.system) !== 'directories.system' ||
						mappings.get(expected.placeholders[group]) !== expected.mapping_keys[group]
					) {
						add(
							'operation_target_mismatch',
							assetPath(path),
							`Archive 机器目标或正文规则与权威归档路径不一致：${key}`,
						);
					}
				}
			}
			if (EXTENDED_WRITE_SKILLS.has(skill) && !isValidExtendedWriteContract(operation)) {
				add(
					'invalid_skill_operation_contract',
					assetPath(path),
					'修改型技能必须声明 guard、manifest、recovery 与状态变更边界',
				);
			}
			const declared = declaredPathPlaceholders(body);
			for (const [, target] of operationTargetEntries(operation)) {
				if (typeof target !== 'string') {
					add('invalid_operation_target', assetPath(path), `操作目标无法归一化：${String(target)}`);
					continue;
				}
				if (!isNormalizableTarget(target))
					add('invalid_operation_target', assetPath(path), `操作目标无法归一化：${target}`);
				for (const placeholder of new Set(target.match(/\{[^{}\n]+\}/g) ?? [])) {
					if (!declared.has(placeholder))
						add(
							'undeclared_operation_placeholder',
							assetPath(path),
							`操作目标使用未声明的逻辑占位符：${placeholder}`,
						);
				}
			}
			if (skill === 'translate') {
				const documented = uniqueOutputPath(body, locale);
				if (typeof operation.target_path !== 'string' || operation.target_path !== documented) {
					add('operation_target_mismatch', assetPath(path), '机器目标与正文唯一产出路径不一致');
				} else {
					const expected = expectedTranslateContract(locale);
					if (
						documented !== expected.target_path ||
						declared.get(expected.resource_placeholder) !== 'directories.resources' ||
						declared.get(expected.translations_placeholder) !==
							'subdirectories.resources.translations'
					) {
						add(
							'invalid_translate_target_contract',
							assetPath(path),
							'Translate 路径映射、正文与机器目标必须绑定资源翻译子目录',
						);
					}
				}
			}
			if (skill === 'knowledge') {
				const expected = expectedKnowledgeTargets(locale);
				const documentedBody = body.split('<!-- operation-safety-v1 -->')[0];
				const documentedPaths = [...documentedBody.matchAll(/`([^`\n]+\.md)`/g)].map(
					(match) => match[1],
				);
				const outputSuffixes = {
					'book-knowledge-note': '/<BookName>/<ChapterName>/<ChapterName>.md',
					'paper-knowledge-note': '/<PaperName>.md',
					wiki: '/<ConceptName>.md',
				};
				for (const [key, target] of Object.entries(expected)) {
					const matchingDocumentedPaths = documentedPaths.filter((path) =>
						path.endsWith(outputSuffixes[key]),
					);
					if (
						operation.target_paths?.[key] !== target ||
						matchingDocumentedPaths.length !== 1 ||
						matchingDocumentedPaths[0] !== target
					) {
						add(
							'operation_target_mismatch',
							assetPath(path),
							`Knowledge 机器目标与正文路径不一致：${key}`,
						);
					}
				}
			}
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
