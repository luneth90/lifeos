import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractPlaceholders } from '../skill-contracts/helpers.js';
import { createPdfFixtures, type PdfFixtures } from './helpers/pdf-fixtures.js';

const scriptPath = join(process.cwd(), 'assets', 'skills', 'read-pdf', 'scripts', 'read_pdf.py');
const fixtures: PdfFixtures[] = [];
const generatedPaths: string[] = [];

function createFixtures(): PdfFixtures {
	const fixture = createPdfFixtures();
	fixtures.push(fixture);
	return fixture;
}

function runScript(args: string[]) {
	return spawnSync('python3', [scriptPath, ...args], { encoding: 'utf-8' });
}

function extract(pdfPath: string, outputPath: string | undefined, target = '1') {
	const args = [pdfPath, target, '--skip-render'];
	if (outputPath) args.push('--output', outputPath);
	const result = runScript(args);
	expect(result.status, result.stderr).toBe(0);
	const actualOutputPath = outputPath ?? result.stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim();
	expect(actualOutputPath).toBeTruthy();
	generatedPaths.push(actualOutputPath as string);
	return {
		output: JSON.parse(readFileSync(actualOutputPath as string, 'utf-8')) as Record<string, unknown>,
		stdout: result.stdout,
	};
}

afterEach(() => {
	for (const fixture of fixtures.splice(0)) fixture.cleanup();
	for (const generatedPath of generatedPaths.splice(0)) rmSync(generatedPath, { force: true, recursive: true });
});

describe('read_pdf.py 提取包', () => {
	it('为含文字层的 PDF 输出版本化的逐页提取包', () => {
		const fixture = createFixtures();
		const { output } = extract(fixture.textPdf, join(fixture.workspace, 'text-result.json'));
		const source = output.source as Record<string, unknown>;
		const extractor = output.extractor as Record<string, unknown>;
		const pages = output.pages as Array<Record<string, unknown>>;
		const firstPage = pages[0];
		const blocks = firstPage.blocks as Array<Record<string, unknown>>;

		expect(output.schema_version).toBe(1);
		expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(source.mtime).toEqual(expect.any(String));
		expect(extractor.name).toBe('lifeos-read-pdf');
		expect(output.requested_pages).toEqual([1]);
		expect(pages[0].pdf_page_index).toBe(1);
		expect(pages[0].printed_page_label).toBeNull();
		expect(blocks[0].kind).toBe('text');
		expect(firstPage.status).toBe('complete');
	});

	it('将没有文字层的页面标记为需要 OCR，而不是完整页面', () => {
		const fixture = createFixtures();
		const { output } = extract(fixture.noTextLayerPdf, join(fixture.workspace, 'no-text-result.json'));
		const page = (output.pages as Array<Record<string, unknown>>)[0];

		expect(page.status).toBe('needs_ocr');
		expect(page.coverage).toBe(0);
		expect(page.errors).toEqual([expect.stringMatching(/^TEXT_LAYER_MISSING$/)]);
	});

	it('将页脚中可验证的印刷页码与物理 PDF 页序分开输出', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'printed-label-result.json');
		const result = runScript([fixture.printedLabelPdf, '10', '--skip-render', '--output', outputPath]);
		expect(result.status, result.stderr).toBe(0);
		generatedPaths.push(outputPath);
		const page = (JSON.parse(readFileSync(outputPath, 'utf-8')) as { pages: Array<Record<string, unknown>> }).pages[0];

		expect(page.pdf_page_index).toBe(10);
		expect(page.printed_page_label).toBe('1');
	});

	it('保留离散 target 的精确请求页而不把中间页误称为已请求', () => {
		const fixture = createFixtures();
		const { output } = extract(fixture.sparsePagesPdf, join(fixture.workspace, 'sparse-result.json'), '1,3');

		expect(output.requested_pages).toEqual([1, 3]);
		expect(output.requested_range).toEqual({ start: 1, end: 3 });
		expect((output.pages as Array<Record<string, unknown>>).map((page) => page.pdf_page_index)).toEqual([1, 3]);
	});

	it('以真实位图公式的有序 blocks 标记部分页面并保留默认渲染目录', () => {
		const fixture = createFixtures();
		const result = runScript([fixture.formulaImagePdf, '1']);
		expect(result.status, result.stderr).toBe(0);
		const outputPath = result.stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim();
		expect(outputPath).toBeTruthy();
		generatedPaths.push(outputPath as string);
		const output = JSON.parse(readFileSync(outputPath as string, 'utf-8')) as Record<string, unknown>;
		const page = (output.pages as Array<Record<string, unknown>>)[0];
		const rendered = output.rendered_images as Array<Record<string, unknown>>;

		expect((page.blocks as Array<Record<string, unknown>>).map((block) => block.kind)).toEqual(['text', 'image', 'text']);
		expect(page.status).toBe('partial');
		expect(page.errors).toEqual(['VISUAL_CONTENT_PENDING']);
		expect(output.summary).toMatchObject({ partial_pages: 1 });
		expect(existsSync(rendered[0].path as string)).toBe(true);
		generatedPaths.push(join(rendered[0].path as string, '..'));
	});

	it('输出写入失败时清理本次自动创建的渲染目录，却不删除既有用户目录', () => {
		const fixture = createFixtures();
		const blockedOutput = join(fixture.workspace, 'blocked-output');
		const preexistingImages = join(fixture.workspace, 'blocked-output-images');
		mkdirSync(blockedOutput);
		mkdirSync(preexistingImages);
		writeFileSync(join(preexistingImages, 'user-note.txt'), 'keep');
		const result = runScript([fixture.formulaImagePdf, '1', '--output', blockedOutput]);

		expect(result.status).not.toBe(0);
		expect(existsSync(join(preexistingImages, 'user-note.txt'))).toBe(true);
		expect(readdirSync(fixture.workspace).filter((name) => name.startsWith('blocked-output-images-'))).toEqual([]);
	});

	it('将参数解析失败统一为机器可读错误 JSON', () => {
		const fixture = createFixtures();
		for (const args of [[], [fixture.textPdf, '1', '--dpi', 'bad'], [fixture.textPdf, '1', '--unknown-flag']]) {
			const result = runScript(args);
			expect(result.status).not.toBe(0);
			const error = JSON.parse(result.stderr) as { error: { code: string; message: string } };
			expect(error.error.code).toMatch(/^[A-Z_]+$/);
			expect(error.error.message).not.toBe('');
		}
	});

	it('双语翻译技能消费全部模板占位符，包括按精确请求页生成的印刷页码', () => {
		const placeholders = [
			'{{TITLE}}',
			'{{DATE}}',
			'{{SOURCE}}',
			'{{PROJECT}}',
			'{{PDF_PAGE_RANGE}}',
			'{{PDF_PAGE_LABELS}}',
			'{{COMPLETENESS}}',
			'{{DOMAIN}}',
			'{{ID}}',
		];
		for (const language of ['zh', 'en']) {
			const template = readFileSync(join(process.cwd(), 'assets', 'templates', language, 'Translation_Template.md'), 'utf-8');
			const skill = readFileSync(join(process.cwd(), 'assets', 'skills', 'translate', `SKILL.${language}.md`), 'utf-8');
			expect([...new Set(extractPlaceholders(template))]).toEqual(placeholders);
			for (const placeholder of placeholders) expect(skill).toContain(placeholder.slice(2, -2));
			expect(skill).toContain('requested_pages');
		}
	});

	it('默认输出文件名包含微秒和来源摘要前缀', () => {
		const fixture = createFixtures();
		const { stdout } = extract(fixture.textPdf, undefined);
		const outputPath = stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim() ?? '';

		expect(outputPath).toMatch(/read-pdf-\d{8}-\d{6}-\d{6}-[a-f0-9]{8}\.json$/);
		expect(existsSync(outputPath)).toBe(true);
	});
});
