import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const validatorPath = join(
	process.cwd(),
	'assets',
	'skills',
	'read-pdf',
	'scripts',
	'validate_pdf_extraction.py',
);
const temporaryDirectories: string[] = [];

interface Diagnostic {
	code: string;
	path: string;
}

function completePage(index = 1) {
	return {
		pdf_page_index: index,
		printed_page_label: null,
		status: 'complete',
		coverage: 1,
		confidence: 1,
		errors: [],
		blocks: [{ kind: 'text', order: 1, content: `page ${index}` }],
	};
}

function completePackage(indices = [1]) {
	return {
		schema_version: 1,
		source: {
			path: '70_资源/书籍/example.pdf',
			sha256: 'a'.repeat(64),
			mtime: '2026-07-31T00:00:00Z',
			page_count: 10,
		},
		extractor: { name: 'lifeos-read-pdf', version: '1' },
		requested_range: { start: Math.min(...indices), end: Math.max(...indices) },
		requested_pages: indices,
		pages: indices.map(completePage),
		summary: {
			complete_pages: indices.length,
			needs_ocr_pages: 0,
			partial_pages: 0,
			failed_pages: 0,
		},
	};
}

function partialPackage() {
	const value = completePackage();
	value.pages[0] = {
		...value.pages[0],
		status: 'partial',
		coverage: 0.5,
		errors: ['VISUAL_CONTENT_PENDING'],
	};
	value.summary = {
		complete_pages: 0,
		needs_ocr_pages: 0,
		partial_pages: 1,
		failed_pages: 0,
	};
	return value;
}

function runValidator(value: unknown, args: string[] = []) {
	const directory = mkdtempSync(join(tmpdir(), 'lifeos-pdf-validator-'));
	temporaryDirectories.push(directory);
	const packagePath = join(directory, 'package.json');
	writeFileSync(packagePath, JSON.stringify(value));
	return spawnSync('python3', [validatorPath, packagePath, ...args], { encoding: 'utf-8' });
}

function diagnostics(result: ReturnType<typeof runValidator>): Diagnostic[] {
	const output = JSON.parse(result.stderr) as { diagnostics: Diagnostic[] };
	return output.diagnostics;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe('PDF 提取包完整性校验 CLI', () => {
	it('接受合法 complete 包并通过强完整性门禁', () => {
		const result = runValidator(completePackage(), ['--require-complete']);
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
	});

	it('接受合法 partial 包，但强完整性门禁拒绝它', () => {
		const partial = runValidator(partialPackage());
		expect(partial.status, partial.stderr).toBe(0);

		const required = runValidator(partialPackage(), ['--require-complete']);
		expect(required.status).toBe(1);
		expect(diagnostics(required)).toContainEqual({ code: 'package_incomplete', path: '$.pages' });
	});

	it('按实际 Schema 子集拒绝缺失的结构字段', () => {
		const { summary: _summary, ...value } = completePackage();
		const result = runValidator(value);

		expect(result.status).toBe(1);
		expect(diagnostics(result)).toContainEqual({ code: 'schema_required', path: '$.summary' });
	});

	it.each([
		[
			'字段类型',
			(value: ReturnType<typeof completePackage>) =>
				Object.assign(value.source, { page_count: '10' }),
			'schema_type',
		],
		[
			'未知字段',
			(value: ReturnType<typeof completePackage>) =>
				Object.assign(value.source, { local_secret: 'x' }),
			'schema_additional_property',
		],
		[
			'固定值',
			(value: ReturnType<typeof completePackage>) =>
				Object.assign(value.extractor, { version: '2' }),
			'schema_const',
		],
		[
			'布尔值冒充固定整数',
			(value: ReturnType<typeof completePackage>) => Object.assign(value, { schema_version: true }),
			'schema_const',
		],
		[
			'枚举值',
			(value: ReturnType<typeof completePackage>) =>
				Object.assign(value.pages[0], { status: 'done' }),
			'schema_enum',
		],
		[
			'摘要格式',
			(value: ReturnType<typeof completePackage>) => Object.assign(value.source, { sha256: 'bad' }),
			'schema_pattern',
		],
		[
			'时间格式',
			(value: ReturnType<typeof completePackage>) =>
				Object.assign(value.source, { mtime: 'yesterday' }),
			'schema_format',
		],
		[
			'数组下限',
			(value: ReturnType<typeof completePackage>) => Object.assign(value, { requested_pages: [] }),
			'schema_min_items',
		],
		[
			'数值上限',
			(value: ReturnType<typeof completePackage>) => Object.assign(value.pages[0], { coverage: 2 }),
			'schema_maximum',
		],
	])('执行 Schema 子集：%s', (_name, mutate, code) => {
		const value = completePackage();
		mutate(value);
		const result = runValidator(value);

		expect(result.status).toBe(1);
		expect(diagnostics(result).map((item) => item.code)).toContain(code);
	});

	it.each([
		'/Users/alice/book.pdf',
		'../book.pdf',
		'books/../book.pdf',
		'C:\\Users\\alice\\book.pdf',
	])('拒绝泄露本机位置的 source.path：%s', (sourcePath) => {
		const value = completePackage();
		value.source.path = sourcePath;
		const result = runValidator(value);

		expect(result.status).toBe(1);
		expect(diagnostics(result).map((item) => item.code)).toContain('schema_pattern');
	});

	it('拒绝覆盖率、错误和图像占位符伪造的 complete 页面', () => {
		const value = completePackage();
		value.pages[0].coverage = 0.5;
		value.pages[0].errors = ['VISUAL_CONTENT_PENDING'];
		value.pages[0].blocks = [{ kind: 'image', order: 1, content: '' }];
		const result = runValidator(value, ['--require-complete']);
		const codes = diagnostics(result).map((item) => item.code);

		expect(result.status).toBe(1);
		expect(codes).toEqual(
			expect.arrayContaining(['complete_coverage', 'complete_errors', 'complete_image_blocks']),
		);
	});

	it.each([
		['缺页', [1, 2], [completePage(1)], 'page_sequence_mismatch'],
		['重复页', [1, 1], [completePage(1), completePage(1)], 'schema_unique_items'],
		['乱序页', [2, 1], [completePage(2), completePage(1)], 'requested_pages_order'],
	])('拒绝%s', (_name, requestedPages, pages, code) => {
		const value = completePackage([1, 2]);
		value.requested_pages = requestedPages as number[];
		value.pages = pages as ReturnType<typeof completePage>[];
		value.summary.complete_pages = pages.length;
		const result = runValidator(value);

		expect(result.status).toBe(1);
		expect(diagnostics(result).map((item) => item.code)).toContain(code);
	});

	it.each([
		['起点大于终点', { start: 2, end: 1 }, 'requested_range_order'],
		['包络与请求页不一致', { start: 1, end: 3 }, 'requested_range_mismatch'],
	])('拒绝 requested_range %s', (_name, requestedRange, code) => {
		const value = completePackage([1, 2]);
		value.requested_range = requestedRange;
		const result = runValidator(value);

		expect(result.status).toBe(1);
		expect(diagnostics(result).map((item) => item.code)).toContain(code);
	});

	it('拒绝与页面状态不一致的 summary', () => {
		const value = completePackage();
		value.summary.complete_pages = 0;
		value.summary.partial_pages = 1;
		const result = runValidator(value);

		expect(result.status).toBe(1);
		expect(diagnostics(result)).toContainEqual({ code: 'summary_mismatch', path: '$.summary' });
	});

	it.each([
		['重复', [1, 1]],
		['断档', [1, 3]],
	])('拒绝 block.order %s', (_name, orders) => {
		const value = completePackage();
		value.pages[0].blocks = orders.map((order) => ({ kind: 'text', order, content: 'x' }));
		const result = runValidator(value);

		expect(result.status).toBe(1);
		expect(diagnostics(result)).toContainEqual({
			code: 'block_order_sequence',
			path: '$.pages[0].blocks',
		});
	});

	it.each([
		['needs_ocr', 1],
		['partial', 1],
		['failed', 0.5],
	])('拒绝以完整语义伪装的 %s 页面', (status, coverage) => {
		const value = completePackage();
		value.pages[0].status = status;
		value.pages[0].coverage = coverage;
		value.pages[0].errors = [];
		value.summary = {
			complete_pages: 0,
			needs_ocr_pages: status === 'needs_ocr' ? 1 : 0,
			partial_pages: status === 'partial' ? 1 : 0,
			failed_pages: status === 'failed' ? 1 : 0,
		};
		const result = runValidator(value);
		const codes = diagnostics(result).map((item) => item.code);

		expect(result.status).toBe(1);
		expect(codes).toContain('incomplete_errors');
		expect(codes).toContain(status === 'failed' ? 'failed_coverage' : 'incomplete_coverage');
	});

	it('读取指定 Schema，而不是绕过结构契约', () => {
		const directory = mkdtempSync(join(tmpdir(), 'lifeos-pdf-schema-'));
		temporaryDirectories.push(directory);
		const schema = JSON.parse(
			readFileSync(join(process.cwd(), 'assets', 'schema', 'PDF_Extraction_Schema.json'), 'utf-8'),
		) as { required: string[] };
		schema.required.push('proof_of_schema_read');
		const schemaPath = join(directory, 'schema.json');
		writeFileSync(schemaPath, JSON.stringify(schema));
		const result = runValidator(completePackage(), ['--schema', schemaPath]);

		expect(result.status).toBe(1);
		expect(diagnostics(result)).toContainEqual({
			code: 'schema_required',
			path: '$.proof_of_schema_read',
		});
	});

	it('Schema 新增未实现关键字时失败关闭而不是静默跳过', () => {
		const directory = mkdtempSync(join(tmpdir(), 'lifeos-pdf-schema-keyword-'));
		temporaryDirectories.push(directory);
		const schema = JSON.parse(
			readFileSync(join(process.cwd(), 'assets', 'schema', 'PDF_Extraction_Schema.json'), 'utf-8'),
		) as { properties: { requested_pages: Record<string, unknown> } };
		schema.properties.requested_pages.maxItems = 1;
		const schemaPath = join(directory, 'schema.json');
		writeFileSync(schemaPath, JSON.stringify(schema));
		const result = runValidator(completePackage([1, 2]), ['--schema', schemaPath]);

		expect(result.status).toBe(1);
		expect(diagnostics(result)).toContainEqual({
			code: 'schema_unsupported_keyword',
			path: '$.requested_pages',
		});
	});
});

describe('PDF 消费流程契约', () => {
	it('read-pdf 双语流程在初始提取和视觉合并后各校验一次且只处理待补充页面', () => {
		for (const language of ['zh', 'en']) {
			const skill = readFileSync(
				join(process.cwd(), 'assets', 'skills', 'read-pdf', `SKILL.${language}.md`),
				'utf-8',
			);
			const body = skill.split('---').slice(2).join('---');
			expect(body.match(/validate_pdf_extraction\.py/g), language).toHaveLength(2);
			const schemaPath =
				language === 'zh'
					? '"{系统目录}/{规范子目录}/PDF_Extraction_Schema.json"'
					: '"{system directory}/{schema subdirectory}/PDF_Extraction_Schema.json"';
			expect(
				body.match(new RegExp(`--schema ${schemaPath.replace(/[{}\/\.]/g, '\\$&')}`, 'g')),
				language,
			).toHaveLength(2);
			expect(skill, language).toMatch(/needs_ocr[\s\S]*partial[\s\S]*image/);
			expect(skill, language).not.toMatch(/逐页渲染|analy[sz]e every page/i);
		}
	});

	it('translate 双语流程仅在 require-complete 通过后从 draft 更新为 complete', () => {
		for (const language of ['zh', 'en']) {
			const skill = readFileSync(
				join(process.cwd(), 'assets', 'skills', 'translate', `SKILL.${language}.md`),
				'utf-8',
			);
			const draftIndex = skill.indexOf('status: draft');
			const gateIndex = skill.indexOf('validate_pdf_extraction.py');
			const requireIndex = skill.indexOf('--require-complete', gateIndex);
			const completeIndex = skill.indexOf('status: complete', requireIndex);
			const schemaPath =
				language === 'zh'
					? '--schema "{系统目录}/{规范子目录}/PDF_Extraction_Schema.json"'
					: '--schema "{system directory}/{schema subdirectory}/PDF_Extraction_Schema.json"';
			expect(draftIndex, language).toBeGreaterThanOrEqual(0);
			expect(gateIndex, language).toBeGreaterThan(draftIndex);
			expect(requireIndex, language).toBeGreaterThan(gateIndex);
			expect(skill.slice(gateIndex, completeIndex), language).toContain(schemaPath);
			expect(completeIndex, language).toBeGreaterThan(requireIndex);
			expect(skill.slice(gateIndex, completeIndex), language).toMatch(/保持.*draft|keep.*draft/is);
		}
	});
});
