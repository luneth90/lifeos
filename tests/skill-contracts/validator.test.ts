import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN_PRESET } from '../../src/config.js';

const repositoryRoot = process.cwd();
const scriptPath = join(repositoryRoot, 'scripts', 'validate-skill-contracts.mjs');

async function loadValidator(): Promise<
	typeof import('../../scripts/validate-skill-contracts.mjs')
> {
	return import(scriptPath);
}

describe('技能契约校验器', () => {
	it('英文默认路径映射与运行时配置保持一致', async () => {
		const { englishDefaultPathConfig } = await loadValidator();
		expect(englishDefaultPathConfig()).toEqual({
			directories: EN_PRESET.directories,
			subdirectories: EN_PRESET.subdirectories,
		});
	});

	it('缺少 assets 根目录时返回结构化诊断', async () => {
		const { validateSkillContracts } = await loadValidator();
		const result = validateSkillContracts(join(tmpdir(), `lifeos-missing-assets-${Date.now()}`));
		expect(result).toMatchObject({
			ok: false,
			diagnostics: [
				{
					code: 'missing_assets_root',
					path: '.',
					message: expect.stringContaining('找不到 assets 目录'),
				},
			],
		});
	});

	async function expectMutatedAssetsDiagnostic(
		mutate: (write: (relativePath: string, transform: (content: string) => string) => void) => void,
		expected: { code: string; path: string; related_path?: string },
	): Promise<void> {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-contract-red-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			const write = (relativePath: string, transform: (content: string) => string) => {
				const path = join(root, relativePath);
				writeFileSync(path, transform(readFileSync(path, 'utf8')));
			};
			mutate(write);

			const { validateSkillContracts } = await loadValidator();
			expect(validateSkillContracts(root).diagnostics).toEqual(
				expect.arrayContaining([expect.objectContaining(expected)]),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}

	async function expectExactMutatedAssetsDiagnostics(
		mutate: (write: (relativePath: string, transform: (content: string) => string) => void) => void,
		expected: Array<{ code: string; path: string; related_path?: string; message: string }>,
	): Promise<void> {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-contract-exact-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			const write = (relativePath: string, transform: (content: string) => string) => {
				const path = join(root, relativePath);
				writeFileSync(path, transform(readFileSync(path, 'utf8')));
			};
			mutate(write);
			const { validateSkillContracts } = await loadValidator();
			expect(validateSkillContracts(root).diagnostics).toEqual(expected);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}

	async function expectMutatedAssetsOk(
		mutate: (write: (relativePath: string, transform: (content: string) => string) => void) => void,
	): Promise<void> {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-contract-control-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			const write = (relativePath: string, transform: (content: string) => string) => {
				const path = join(root, relativePath);
				writeFileSync(path, transform(readFileSync(path, 'utf8')));
			};
			mutate(write);
			const { validateSkillContracts } = await loadValidator();
			expect(validateSkillContracts(root)).toEqual({ ok: true, diagnostics: [] });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}

	it.each([
		[
			'中文物理路径',
			(write) =>
				write(
					'assets/skills/_shared/memory-protocol.zh.md',
					(content) => `${content}\n00_草稿/leak.md\n`,
				),
			{ code: 'hardcoded_logical_path', path: 'assets/skills/_shared/memory-protocol.zh.md' },
		],
		[
			'英文物理路径',
			(write) =>
				write(
					'assets/skills/_shared/memory-protocol.en.md',
					(content) => `${content}\n00_Drafts/leak.md\n`,
				),
			{ code: 'hardcoded_logical_path', path: 'assets/skills/_shared/memory-protocol.en.md' },
		],
		[
			'遗漏 Schema 生成类型映射',
			(write) =>
				write('assets/schema/Frontmatter_Schema.md', (content) =>
					content.replace('  note:\n    statuses: []\n    template: Daily_Template.md\n', ''),
				),
			{ code: 'unknown_generated_type', path: 'assets/templates/en/Daily_Template.md' },
		],
		[
			'缺少操作预检字段但保留正文关键词',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('preflight: required\n', '').replace('**Preflight**', '**preflight**'),
				),
			{
				code: 'invalid_operation_safety_contract',
				path: 'assets/skills/_shared/operation-safety.en.md',
			},
		],
		[
			'缺少操作清单字段',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('manifest:', 'manifest_removed:'),
				),
			{
				code: 'invalid_operation_safety_contract',
				path: 'assets/skills/_shared/operation-safety.en.md',
			},
		],
		[
			'错误操作决策枚举',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace(
						'decision: [create, merge, resume, skip, replace]',
						'decision: [create, overwrite]',
					),
				),
			{
				code: 'invalid_operation_safety_contract',
				path: 'assets/skills/_shared/operation-safety.en.md',
			},
		],
		[
			'遗漏修改型技能的协议依赖',
			(write) =>
				write('assets/skills/ask/SKILL.en.md', (content) =>
					content.replace('  protocols:\n    - path: ../_shared/operation-safety.md\n', ''),
				),
			{ code: 'missing_operation_safety_reference', path: 'assets/skills/ask/SKILL.en.md' },
		],
		[
			'能力机器数组漂移',
			(write) =>
				write('assets/skills/_shared/client-capabilities.en.md', (content) =>
					content.replace('"exec_command"', '"shell_command"'),
				),
			{
				code: 'capability_contract_mismatch',
				path: 'assets/skills/_shared/client-capabilities.zh.md',
				related_path: 'assets/skills/_shared/client-capabilities.en.md',
			},
		],
		[
			'能力版本漂移',
			(write) =>
				write('assets/skills/_shared/client-capabilities.en.md', (content) =>
					content.replace('contract_version: 1', 'contract_version: 2'),
				),
			{
				code: 'capability_contract_mismatch',
				path: 'assets/skills/_shared/client-capabilities.zh.md',
			},
		],
		[
			'客户端专有样例索引越界',
			(write) =>
				write('assets/skills/_shared/client-capabilities.en.md', (content) =>
					content.replace(
						'client_specific_example_indexes: [0]',
						'client_specific_example_indexes: [99]',
					),
				),
			{
				code: 'invalid_capability_contract',
				path: 'assets/skills/_shared/client-capabilities.en.md',
			},
		],
		[
			'正文泄漏客户端专有能力名',
			(write) =>
				write(
					'assets/skills/ask/SKILL.en.md',
					(content) => `${content}\nUse AskUserQuestion to continue.\n`,
				),
			{
				code: 'client_specific_capability_name',
				path: 'assets/skills/ask/SKILL.en.md',
			},
		],
		[
			'调用语境泄漏单词型客户端专有能力名',
			(write) =>
				write(
					'assets/skills/ask/SKILL.en.md',
					(content) => `${content}\nUse Task to spawn a worker.\n`,
				),
			{
				code: 'client_specific_capability_name',
				path: 'assets/skills/ask/SKILL.en.md',
			},
		],
		[
			'引用文档泄漏客户端专有能力名',
			(write) =>
				write(
					'assets/skills/digest/references/run-pipeline.en.md',
					(content) => `${content}\nRun WebSearch to continue.\n`,
				),
			{
				code: 'client_specific_capability_name',
				path: 'assets/skills/digest/references/run-pipeline.en.md',
			},
		],
		[
			'能力协议 examples 以外泄漏客户端专有名',
			(write) =>
				write(
					'assets/skills/_shared/client-capabilities.en.md',
					(content) => `${content}\nUse WebFetch directly.\n`,
				),
			{
				code: 'client_specific_capability_name',
				path: 'assets/skills/_shared/client-capabilities.en.md',
			},
		],
		[
			'同名模板但错误逻辑目录',
			(write) =>
				write('assets/skills/ask/SKILL.en.md', (content) =>
					content.replace(
						'{system directory}/{templates subdirectory}/Draft_Template.md',
						'{system directory}/wrong/Draft_Template.md',
					),
				),
			{ code: 'invalid_dependency_path', path: 'assets/skills/ask/SKILL.en.md' },
		],
	])('拒绝%s', async (_name, mutate, expected) => {
		await expectMutatedAssetsDiagnostic(mutate, expected);
	});

	it('允许普通 Task A 管线标签', async () => {
		await expectMutatedAssetsOk((write) =>
			write(
				'assets/skills/digest/references/run-pipeline.en.md',
				(content) => `${content}\n#### Task E: Local-only source\n`,
			),
		);
	});

	it.each([
		['默认物理子目录', 'Books'],
		['未配置固定子目录', 'Courses'],
	])('拒绝逻辑资源目录后的%s：%s', async (_name, child) => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write(
					'assets/skills/read-pdf/SKILL.en.md',
					(content) => `${content}\n{resources directory}/${child}/leak.pdf\n`,
				),
			[
				{
					code: 'hardcoded_logical_path',
					path: 'assets/skills/read-pdf/SKILL.en.md',
					message: `逻辑资源目录后不得使用固定子目录：${child}`,
				},
			],
		);
	});

	it('拒绝 Translate 双语路径映射、正文与机器目标共同漂到书籍子目录', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) => {
				write('assets/skills/translate/SKILL.en.md', (content) =>
					content
						.replaceAll('{translations subdirectory}', '{books subdirectory}')
						.replace('subdirectories.resources.translations', 'subdirectories.resources.books'),
				);
				write('assets/skills/translate/SKILL.zh.md', (content) =>
					content
						.replaceAll('{翻译子目录}', '{书籍子目录}')
						.replace('subdirectories.resources.translations', 'subdirectories.resources.books'),
				);
			},
			[
				{
					code: 'invalid_translate_target_contract',
					path: 'assets/skills/translate/SKILL.en.md',
					message: 'Translate 路径映射、正文与机器目标必须绑定资源翻译子目录',
				},
				{
					code: 'invalid_translate_target_contract',
					path: 'assets/skills/translate/SKILL.zh.md',
					message: 'Translate 路径映射、正文与机器目标必须绑定资源翻译子目录',
				},
			],
		);
	});

	it('拒绝 Archive 的 plan 机器目标漂到合法的草稿归档目录', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) => {
				write('assets/skills/archive/SKILL.en.md', (content) =>
					content.replace(
						'  plan: "{system directory}/{archived plans subdirectory}/<filename>.md"',
						'  plan: "{system directory}/{archived drafts subdirectory}/YYYY/MM/<filename>.md"',
					),
				);
				write('assets/skills/archive/SKILL.zh.md', (content) =>
					content.replace(
						'  plan: "{系统目录}/{归档计划子目录}/<filename>.md"',
						'  plan: "{系统目录}/{归档草稿子目录}/YYYY/MM/<filename>.md"',
					),
				);
			},
			[
				{
					code: 'operation_target_mismatch',
					path: 'assets/skills/archive/SKILL.en.md',
					message: 'Archive 机器目标或正文规则与权威归档路径不一致：plan',
				},
				{
					code: 'operation_target_mismatch',
					path: 'assets/skills/archive/SKILL.zh.md',
					message: 'Archive 机器目标或正文规则与权威归档路径不一致：plan',
				},
			],
		);
	});

	it('拒绝 Archive 发布事务脚本 dependency 指向不存在的资产', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/skills/archive/SKILL.en.md', (content) =>
					content.replace('scripts/archive_transaction.mjs', 'scripts/missing_transaction.mjs'),
				),
			[
				{
					code: 'invalid_archive_transaction_contract',
					path: 'assets/skills/archive/SKILL.en.md',
					message: 'Archive 发布事务、manifest 或 resume 机器字段非法',
				},
				{
					code: 'missing_dependency',
					path: 'assets/skills/archive/SKILL.en.md',
					related_path: 'assets/skills/archive/scripts/missing_transaction.mjs',
					message: '依赖不存在：scripts/missing_transaction.mjs',
				},
			],
		);
	});

	it('拒绝 Archive 仅英文恢复字段漂移', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/skills/archive/SKILL.en.md', (content) =>
					content.replace(
						'skip_confirmed_files: trusted_receipt_only',
						'skip_confirmed_files: false',
					),
				),
			[
				{
					code: 'invalid_archive_transaction_contract',
					path: 'assets/skills/archive/SKILL.en.md',
					message: 'Archive 发布事务、manifest 或 resume 机器字段非法',
				},
			],
		);
	});

	it('拒绝 Archive 可信持久化回执要求漂移', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/skills/archive/SKILL.zh.md', (content) =>
					content.replace(
						'receipt_required_for_resume: true',
						'receipt_required_for_resume: false',
					),
				),
			[
				{
					code: 'invalid_archive_transaction_contract',
					path: 'assets/skills/archive/SKILL.zh.md',
					message: 'Archive 发布事务、manifest 或 resume 机器字段非法',
				},
			],
		);
	});

	it('拒绝 Archive 在失败后继续其他候选', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/skills/archive/SKILL.en.md', (content) =>
					content.replace('continue_other_candidates: false', 'continue_other_candidates: true'),
				),
			[
				{
					code: 'invalid_archive_transaction_contract',
					path: 'assets/skills/archive/SKILL.en.md',
					message: 'Archive 发布事务、manifest 或 resume 机器字段非法',
				},
			],
		);
	});

	it('拒绝 Archive 恢复事务完成后的未受保护写入', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/skills/archive/SKILL.en.md', (content) =>
					content.replace('current_run: forbidden', 'current_run: allowed'),
				),
			[
				{
					code: 'invalid_archive_transaction_contract',
					path: 'assets/skills/archive/SKILL.en.md',
					message: 'Archive 发布事务、manifest 或 resume 机器字段非法',
				},
			],
		);
	});

	it.each([
		[
			'Vault 身份字段',
			'identity_fields: [realpath, root_dev, root_ino]',
			'identity_fields: [realpath]',
		],
		['Vault 身份贯穿复核时点', '  - after_external_await', '  - after_selected_external_await'],
		['未受信失败持久化', 'persist_manifest: forbidden', 'persist_manifest: allowed'],
		[
			'最终同步复核后继续 await',
			'await_after_final_revalidation: forbidden',
			'await_after_final_revalidation: allowed',
		],
	])('拒绝 Archive 安全边界漂移：%s', async (_name, original, replacement) => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/skills/archive/SKILL.en.md', (content) =>
					content.replace(original, replacement),
				),
			[
				{
					code: 'invalid_archive_transaction_contract',
					path: 'assets/skills/archive/SKILL.en.md',
					message: 'Archive 发布事务、manifest 或 resume 机器字段非法',
				},
			],
		);
	});

	it('拒绝 Read PDF 双语共同声明不存在的 courses 资源配置键', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) => {
				write('assets/skills/read-pdf/SKILL.en.md', (content) =>
					content
						.replaceAll('{books subdirectory}', '{courses subdirectory}')
						.replace('subdirectories.resources.books', 'subdirectories.resources.courses'),
				);
				write('assets/skills/read-pdf/SKILL.zh.md', (content) =>
					content
						.replaceAll('{书籍子目录}', '{课程子目录}')
						.replace('subdirectories.resources.books', 'subdirectories.resources.courses'),
				);
			},
			[
				{
					code: 'invalid_path_mapping',
					path: 'assets/skills/read-pdf/SKILL.en.md',
					message: '逻辑路径映射未解析到 lifeos.yaml 权威配置键：{courses subdirectory}',
				},
				{
					code: 'invalid_path_mapping',
					path: 'assets/skills/read-pdf/SKILL.zh.md',
					message: '逻辑路径映射未解析到 lifeos.yaml 权威配置键：{课程子目录}',
				},
			],
		);
	});

	it('允许已声明资源子目录后的动态文件名', async () => {
		await expectMutatedAssetsOk((write) =>
			write(
				'assets/skills/read-pdf/SKILL.en.md',
				(content) =>
					`${content}\n{resources directory}/{books subdirectory}/<runtime-file-name>.pdf\n`,
			),
		);
	});

	it.each([
		[
			'机器目标使用未声明逻辑占位符',
			(write) =>
				write('assets/skills/translate/SKILL.en.md', (content) =>
					content.replace(
						'target_path: "{resources directory}/{translations subdirectory}/<book-name>/<chapter-name>.md"',
						'target_path: "{knowledge directory}/<book-name>/<chapter-name>.md"',
					),
				),
			[
				{
					code: 'operation_target_mismatch',
					path: 'assets/skills/translate/SKILL.en.md',
					message: '机器目标与正文唯一产出路径不一致',
				},
				{
					code: 'undeclared_operation_placeholder',
					path: 'assets/skills/translate/SKILL.en.md',
					message: '操作目标使用未声明的逻辑占位符：{knowledge directory}',
				},
			],
		],
		[
			'机器目标不可归一化',
			(write) =>
				write('assets/skills/translate/SKILL.en.md', (content) =>
					content.replace(
						'target_path: "{resources directory}/{translations subdirectory}/<book-name>/<chapter-name>.md"',
						'target_path: "../{resources directory}/{translations subdirectory}/<book-name>/<chapter-name>.md"',
					),
				),
			[
				{
					code: 'invalid_operation_target',
					path: 'assets/skills/translate/SKILL.en.md',
					message:
						'操作目标无法归一化：../{resources directory}/{translations subdirectory}/<book-name>/<chapter-name>.md',
				},
				{
					code: 'operation_target_mismatch',
					path: 'assets/skills/translate/SKILL.en.md',
					message: '机器目标与正文唯一产出路径不一致',
				},
			],
		],
		[
			'机器目标与唯一正文输出漂移',
			(write) =>
				write('assets/skills/translate/SKILL.en.md', (content) =>
					content.replace(
						'target_path: "{resources directory}/{translations subdirectory}/<book-name>/<chapter-name>.md"',
						'target_path: "{resources directory}/{translations subdirectory}/<book-name>/wrong.md"',
					),
				),
			[
				{
					code: 'operation_target_mismatch',
					path: 'assets/skills/translate/SKILL.en.md',
					message: '机器目标与正文唯一产出路径不一致',
				},
			],
		],
	] as const)('拒绝%s', async (_name, mutate, expected) => {
		await expectExactMutatedAssetsDiagnostics(mutate, [...expected]);
	});

	it('拒绝 Archive 退回未声明占位符和省略号的共同错误目标', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/skills/archive/SKILL.en.md', (content) =>
					content.replace(
						/target_paths:\n(?: {2}.*\n){5}/,
						'target_path: "{system directory}/{archive subdirectory}/..."\n',
					),
				),
			[
				{
					code: 'invalid_archive_target_map',
					path: 'assets/skills/archive/SKILL.en.md',
					message:
						'Archive 必须完整声明 project-file、project-directory、draft、plan、diary 目标映射',
				},
			],
		);
	});

	it('拒绝 Knowledge 的论文机器目标复用书籍章节目录结构', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) => {
				write('assets/skills/knowledge/SKILL.en.md', (content) =>
					content.replace(
						'  paper-knowledge-note: "{knowledge directory}/{notes subdirectory}/<Domain>/<PaperName>.md"',
						'  paper-knowledge-note: "{knowledge directory}/{notes subdirectory}/<Domain>/<PaperName>/<ChapterName>/<ChapterName>.md"',
					),
				);
				write('assets/skills/knowledge/SKILL.zh.md', (content) =>
					content.replace(
						'  paper-knowledge-note: "{知识目录}/{笔记子目录}/<Domain>/<PaperName>.md"',
						'  paper-knowledge-note: "{知识目录}/{笔记子目录}/<Domain>/<PaperName>/<ChapterName>/<ChapterName>.md"',
					),
				);
			},
			[
				{
					code: 'operation_target_mismatch',
					path: 'assets/skills/knowledge/SKILL.en.md',
					message: 'Knowledge 机器目标与正文路径不一致：paper-knowledge-note',
				},
				{
					code: 'operation_target_mismatch',
					path: 'assets/skills/knowledge/SKILL.zh.md',
					message: 'Knowledge 机器目标与正文路径不一致：paper-knowledge-note',
				},
			],
		);
	});

	it.each([
		{
			locale: '英文',
			path: 'assets/skills/knowledge/SKILL.en.md',
			original: '- Path: `{knowledge directory}/{wiki subdirectory}/<Domain>/<ConceptName>.md`.',
			reference:
				'- Output path: follow the single Wiki output rule in Step 4, "Extract Wiki Concepts".',
			wrong: '- Path: `{knowledge directory}/{notes subdirectory}/<Domain>/<ConceptName>.md`.',
		},
		{
			locale: '中文',
			path: 'assets/skills/knowledge/SKILL.zh.md',
			original: '- 路径：`{知识目录}/{百科子目录}/<Domain>/<ConceptName>.md`。',
			reference: '- 产出路径：遵循步骤四“提取百科概念”的唯一 Wiki 输出规则。',
			wrong: '- 路径：`{知识目录}/{笔记子目录}/<Domain>/<ConceptName>.md`。',
		},
	])('拒绝 Knowledge $locale 路径 A 单独漂到 notes 子目录', async (testCase) => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write(testCase.path, (content) => {
					if (content.includes(testCase.original)) {
						return content.replace(testCase.original, testCase.wrong);
					}
					if (content.includes(testCase.reference)) {
						return content.replace(testCase.reference, `${testCase.reference}\n${testCase.wrong}`);
					}
					throw new Error(`找不到 Knowledge 路径 A：${testCase.path}`);
				}),
			[
				{
					code: 'operation_target_mismatch',
					path: testCase.path,
					message: 'Knowledge 机器目标与正文路径不一致：wiki',
				},
			],
		);
	});

	it.each(['project', 'knowledge', 'brainstorm'])('拒绝 %s 缺少操作安全协议依赖', async (skill) => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write(`assets/skills/${skill}/SKILL.en.md`, (content) =>
					content.replace('  protocols:\n    - path: ../_shared/operation-safety.md\n', ''),
				),
			[
				{
					code: 'missing_operation_safety_reference',
					path: `assets/skills/${skill}/SKILL.en.md`,
					message: '修改型技能必须在 Frontmatter protocols 声明 operation-safety',
				},
			],
		);
	});

	it.each(['project', 'knowledge', 'brainstorm'])(
		'拒绝 %s 缺少技能级操作安全机器块',
		async (skill) => {
			await expectExactMutatedAssetsDiagnostics(
				(write) =>
					write(`assets/skills/${skill}/SKILL.en.md`, (content) =>
						content.replace(/\n<!-- operation-safety-v1 -->\n```yaml\n[\s\S]*?\n```\n?$/, '\n'),
					),
				[
					{
						code: 'missing_operation_safety_reference',
						path: `assets/skills/${skill}/SKILL.en.md`,
						message: '修改型技能必须结构化引用 operation-safety-v1',
					},
				],
			);
		},
	);

	it.each([
		['project-doc', 'assets/skills/project/references/execution-agent-prompt.en.md'],
		['system', 'assets/skills/digest/references/setup-guide.en.md'],
		['revise-record', 'assets/templates/en/Revise_Template.md'],
	])('扫描无状态或模板生成类型 %s', async (type, expectedPath) => {
		await expectMutatedAssetsDiagnostic(
			(write) =>
				write('assets/schema/Frontmatter_Schema.md', (content) =>
					content.replace(
						new RegExp(`  ${type}:\\n    statuses: \\[[^\\n]*\\]\\n    template: [^\\n]+\\n`),
						'',
					),
				),
			{ code: 'unknown_generated_type', path: expectedPath },
		);
	});

	it('拒绝引用文件中未知的结构化生成类型，但忽略自然语言 type 字样', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write(
					'assets/skills/project/references/execution-agent-prompt.en.md',
					(content) =>
						`${content}\nA prose mention such as type: conversational is not a generated document.\n\n\`\`\`markdown\n---\ntype: ghost-generated\ntitle: Test\n---\n\`\`\`\n`,
				),
			[
				{
					code: 'unknown_generated_type',
					path: 'assets/skills/project/references/execution-agent-prompt.en.md',
					message: '结构化生成 type 未定义于 Schema：ghost-generated',
				},
			],
		);
	});

	it('拒绝英文 Project 模板 category 固定化，且只报告字段级差异', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/templates/en/Project_Template.md', (content) =>
					content.replace('category: "{{CATEGORY}}"', 'category: learning'),
				),
			[
				{
					code: 'template_frontmatter_mismatch',
					path: 'assets/templates/en/Project_Template.md',
					related_path: 'assets/templates/zh/Project_Template.md',
					message: '中英文模板 Frontmatter 机器字段不一致：category',
				},
			],
		);
	});

	it('拒绝英文 Project 模板缺失 Frontmatter，且不产生双语泛化噪声', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/templates/en/Project_Template.md', (content) =>
					content.replace(/^---\n[\s\S]*?\n---\n/, ''),
				),
			[
				{
					code: 'missing_template_frontmatter',
					path: 'assets/templates/en/Project_Template.md',
					message: '模板缺少 Frontmatter',
				},
			],
		);
	});

	it('拒绝模板 Frontmatter 为非对象值', async () => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/templates/en/Project_Template.md', (content) =>
					content.replace(/^---\n[\s\S]*?\n---\n/, '---\ninvalid\n---\n'),
				),
			[
				{
					code: 'invalid_template_frontmatter',
					path: 'assets/templates/en/Project_Template.md',
					message: '模板 Frontmatter 必须是对象',
				},
			],
		);
	});

	it.each([
		['数组', 'note: []'],
		['对象', 'note: { path: "Knowledge note path" }'],
		['空值', 'note:'],
		['固定真实路径', 'note: "[[Math/Groups]]"'],
		['非 wikilink', 'note: "Knowledge note path"'],
	])('拒绝英文 Revise 模板 note 本地化字段变成%s', async (_name, replacement) => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write('assets/templates/en/Revise_Template.md', (content) =>
					content.replace('note: "[[Knowledge note path]]"', replacement),
				),
			[
				{
					code: 'invalid_localized_template_frontmatter',
					path: 'assets/templates/en/Revise_Template.md',
					related_path: 'assets/templates/zh/Revise_Template.md',
					message: '中英文模板 Frontmatter 本地化字段结构或占位语义不一致：note',
				},
			],
		);
	});

	it.each(['project', 'knowledge'])('非法 %s 技能 Frontmatter 仅返回 YAML 根因', async (skill) => {
		await expectExactMutatedAssetsDiagnostics(
			(write) =>
				write(`assets/skills/${skill}/SKILL.en.md`, (content) =>
					content.replace('dependencies:', 'dependencies: ['),
				),
			[
				{
					code: 'invalid_markdown_frontmatter_yaml',
					path: `assets/skills/${skill}/SKILL.en.md`,
					message: 'Markdown Frontmatter YAML 无法解析',
				},
			],
		);
	});

	it.each(['project', 'knowledge'])('CLI 对非法 %s 技能 Frontmatter 仅输出 YAML 根因', (skill) => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-contract-skill-yaml-cli-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			const path = join(root, `assets/skills/${skill}/SKILL.en.md`);
			writeFileSync(path, readFileSync(path, 'utf8').replace('dependencies:', 'dependencies: ['));
			const result = spawnSync(process.execPath, [scriptPath, root], { encoding: 'utf8' });
			expect(result.status).toBe(1);
			expect(result.stdout).toBe('');
			expect(result.stderr.trim().split('\n').map(JSON.parse)).toEqual([
				{
					code: 'invalid_markdown_frontmatter_yaml',
					path: `assets/skills/${skill}/SKILL.en.md`,
					message: 'Markdown Frontmatter YAML 无法解析',
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each([
		[
			'Markdown Frontmatter',
			'assets/templates/en/Project_Template.md',
			(content: string) => content.replace('tags: [project]', 'tags: [project'),
			{
				code: 'invalid_markdown_frontmatter_yaml',
				path: 'assets/templates/en/Project_Template.md',
				message: 'Markdown Frontmatter YAML 无法解析',
			},
		],
		[
			'marked YAML',
			'assets/skills/_shared/operation-safety.en.md',
			(content: string) =>
				content.replace(
					'decision: [create, merge, resume, skip, replace]',
					'decision: [create, merge',
				),
			{
				code: 'invalid_marked_yaml',
				path: 'assets/skills/_shared/operation-safety.en.md',
				message: '标记 YAML 契约无法解析：operation-safety-v1',
			},
		],
		[
			'lifeos.yaml',
			'assets/lifeos.yaml',
			(content: string) => content.replace('directories:', 'directories: ['),
			{
				code: 'invalid_lifeos_yaml',
				path: 'assets/lifeos.yaml',
				message: 'lifeos.yaml 无法解析',
			},
		],
	] as const)('非法 %s 返回稳定结构化诊断且不抛异常', async (_name, path, transform, expected) => {
		await expectExactMutatedAssetsDiagnostics((write) => write(path, transform), [expected]);
	});

	it('CLI 对非法 YAML 输出稳定 JSON 而不是解析堆栈', () => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-contract-yaml-cli-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			const path = join(root, 'assets/skills/_shared/operation-safety.en.md');
			writeFileSync(
				path,
				readFileSync(path, 'utf8').replace(
					'decision: [create, merge, resume, skip, replace]',
					'decision: [create, merge',
				),
			);
			const result = spawnSync(process.execPath, [scriptPath, root], { encoding: 'utf8' });
			expect(result.status).toBe(1);
			expect(result.stdout).toBe('');
			expect(result.stderr.trim().split('\n').map(JSON.parse)).toEqual([
				{
					code: 'invalid_marked_yaml',
					path: 'assets/skills/_shared/operation-safety.en.md',
					message: '标记 YAML 契约无法解析：operation-safety-v1',
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each([
		[
			'path_guard 标量',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace(
						/path_guard:\n(?: {2}.*\n)+?directory_creation:/,
						'path_guard: invalid\ndirectory_creation:',
					),
				),
		],
		[
			'path_guard 缺少 revalidate',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('  revalidate: revalidateVaultPathGuard\n', ''),
				),
		],
		[
			'manifest 为字符串',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace(
						'manifest: { run_id: string, moves: [], collisions: [], notified: [], errors: [] }',
						'manifest: invalid',
					),
				),
		],
		[
			'通知枚举漂移',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('notification: memory_notify', 'notification: notify'),
				),
		],
		[
			'恢复枚举漂移',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('recovery: resume_same_run_id', 'recovery: retry'),
				),
		],
		[
			'Vault 身份字段漂移',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace(
						'identity_fields: [realpath, root_dev, root_ino]',
						'identity_fields: [realpath]',
					),
				),
		],
		[
			'Vault 身份不再贯穿外部等待',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('  - after_external_await', '  - after_selected_external_await'),
				),
		],
		[
			'未受信恢复允许持久化',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace('persist_manifest: forbidden', 'persist_manifest: allowed'),
				),
		],
		[
			'最终复核后允许 await',
			(write) =>
				write('assets/skills/_shared/operation-safety.en.md', (content) =>
					content.replace(
						'await_after_final_revalidation: forbidden',
						'await_after_final_revalidation: allowed',
					),
				),
		],
	])('独立拒绝操作安全契约：%s', async (_name, mutate) => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-safety-contract-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			mutate((relativePath, transform) => {
				const path = join(root, relativePath);
				writeFileSync(path, transform(readFileSync(path, 'utf8')));
			});
			const { validateSkillContracts } = await loadValidator();
			expect(validateSkillContracts(root).diagnostics).toEqual([
				{
					code: 'invalid_operation_safety_contract',
					path: 'assets/skills/_shared/operation-safety.en.md',
					message: '操作安全机器契约字段或值非法',
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each([
		[
			'run_id',
			'run_id: stable(<skill>, <canonical-input>, <time-window-or-mode>)',
			'run_id: stable(englishly-wrong)',
		],
		['target_path', 'target_path: resolved-vault-relative-path', 'target_path: englishly-wrong'],
	])('仅英文漂移也拒绝操作安全机器值：%s', async (_field, original, replacement) => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-safety-single-locale-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			const path = join(root, 'assets/skills/_shared/operation-safety.en.md');
			writeFileSync(path, readFileSync(path, 'utf8').replace(original, replacement));
			const { validateSkillContracts } = await loadValidator();
			expect(validateSkillContracts(root).diagnostics).toEqual([
				{
					code: 'invalid_operation_safety_contract',
					path: 'assets/skills/_shared/operation-safety.en.md',
					message: '操作安全机器契约字段或值非法',
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each([
		[
			'run_id',
			'run_id: stable(<skill>, <canonical-input>, <time-window-or-mode>)',
			'run_id: stable(sharedly-wrong)',
		],
		['target_path', 'target_path: resolved-vault-relative-path', 'target_path: sharedly-wrong'],
	])('中英文同步漂移也拒绝操作安全机器值：%s', async (_field, original, replacement) => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-safety-bilingual-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			for (const locale of ['en', 'zh']) {
				const path = join(root, `assets/skills/_shared/operation-safety.${locale}.md`);
				writeFileSync(path, readFileSync(path, 'utf8').replace(original, replacement));
			}
			const { validateSkillContracts } = await loadValidator();
			expect(validateSkillContracts(root).diagnostics).toEqual([
				{
					code: 'invalid_operation_safety_contract',
					path: 'assets/skills/_shared/operation-safety.en.md',
					message: '操作安全机器契约字段或值非法',
				},
				{
					code: 'invalid_operation_safety_contract',
					path: 'assets/skills/_shared/operation-safety.zh.md',
					message: '操作安全机器契约字段或值非法',
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each([
		[
			'templates',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace(
						'{system directory}/{templates subdirectory}/Research_Template.md',
						'{typo directory}/{templates subdirectory}/Research_Template.md',
					),
				),
			'依赖路径不符合 templates 语法：{typo directory}/{templates subdirectory}/Research_Template.md',
		],
		[
			'schemas',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace(
						'{system directory}/{schema subdirectory}/Frontmatter_Schema.md',
						'{typo directory}/{schema subdirectory}/Frontmatter_Schema.md',
					),
				),
			'依赖路径不符合 schemas 语法：{typo directory}/{schema subdirectory}/Frontmatter_Schema.md',
		],
		[
			'agents',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace(
						'references/planning-agent-prompt.md',
						'references/../planning-agent-prompt.md',
					),
				),
			'依赖路径不符合 agents 语法：references/../planning-agent-prompt.md',
		],
		[
			'references',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace(
						'  protocols:',
						'  references:\n    - path: references/../planning-agent-prompt.md\n  protocols:',
					),
				),
			'依赖路径不符合 references 语法：references/../planning-agent-prompt.md',
		],
		[
			'prompts',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace(
						'{system directory}/{prompts subdirectory}/',
						'{typo directory}/{prompts subdirectory}/',
					),
				),
			'依赖路径不符合 prompts 语法：{typo directory}/{prompts subdirectory}/',
		],
		[
			'protocols',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace('../_shared/operation-safety.md', '../_shared/other.md'),
				),
			'依赖路径不符合 protocols 语法：../_shared/other.md',
		],
		[
			'未知 Agent 占位符',
			(write) =>
				write('assets/skills/research/SKILL.en.md', (content) =>
					content.replace('invocation: "{{RESEARCH_INPUT}}"', 'invocation: "{{UNKNOWN}}"'),
				),
			'Agent 调用声明与提示词占位符不一致：references/planning-agent-prompt.md',
		],
	])('独立拒绝依赖：%s', async (_name, mutate, expectedMessage) => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-dependency-contract-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			mutate((relativePath, transform) => {
				const path = join(root, relativePath);
				writeFileSync(path, transform(readFileSync(path, 'utf8')));
			});
			const { validateSkillContracts } = await loadValidator();
			const result = validateSkillContracts(root);
			const expectedCode =
				_name === '未知 Agent 占位符' ? 'placeholder_mismatch' : 'invalid_dependency_path';
			expect(result.diagnostics).toEqual([
				{
					code: expectedCode,
					path: 'assets/skills/research/SKILL.en.md',
					message:
						expectedCode === 'placeholder_mismatch'
							? 'Agent 调用声明与提示词占位符不一致：references/planning-agent-prompt.md'
							: expectedMessage,
					...(expectedCode === 'placeholder_mismatch'
						? { related_path: 'assets/skills/research/references/planning-agent-prompt.en.md' }
						: {}),
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('接受声明的 Python 技能脚本并在文件缺失时诊断', async () => {
		const root = mkdtempSync(join(tmpdir(), 'lifeos-python-script-dependency-'));
		cpSync(join(repositoryRoot, 'assets'), join(root, 'assets'), { recursive: true });
		try {
			const { validateSkillContracts } = await loadValidator();
			expect(validateSkillContracts(root)).toEqual({ ok: true, diagnostics: [] });

			rmSync(join(root, 'assets', 'skills', 'read-pdf', 'scripts', 'validate_pdf_extraction.py'));
			expect(validateSkillContracts(root).diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: 'missing_dependency',
						path: 'assets/skills/read-pdf/SKILL.zh.md',
					}),
					expect.objectContaining({
						code: 'missing_dependency',
						path: 'assets/skills/read-pdf/SKILL.en.md',
					}),
				]),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('真实 assets 通过所有跨资产检查', async () => {
		const { validateSkillContracts } = await loadValidator();
		expect(validateSkillContracts(repositoryRoot)).toEqual({ ok: true, diagnostics: [] });
	});

	it('CLI 对缺失 assets 根返回单条 JSON 诊断，对真实 assets 返回 0', () => {
		const missingRoot = join(tmpdir(), `lifeos-missing-assets-cli-${Date.now()}`);
		const failed = spawnSync(process.execPath, [scriptPath, missingRoot], { encoding: 'utf8' });
		expect(failed.status).toBe(1);
		expect(failed.stderr.trim().split('\n').map(JSON.parse)).toEqual([
			{
				code: 'missing_assets_root',
				path: '.',
				message: `找不到 assets 目录：${missingRoot}`,
			},
		]);

		const passed = spawnSync(process.execPath, [scriptPath, repositoryRoot], { encoding: 'utf8' });
		expect(passed.status).toBe(0);
		expect(passed.stdout).toContain('技能契约校验通过');
	});
});
