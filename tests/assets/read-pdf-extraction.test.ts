import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPdfFixtures, type PdfFixtures } from './helpers/pdf-fixtures.js';

const scriptPath = join(process.cwd(), 'assets', 'skills', 'read-pdf', 'scripts', 'read_pdf.py');
const fixtures: PdfFixtures[] = [];
const generatedOutputs: string[] = [];

function createFixtures(): PdfFixtures {
	const fixture = createPdfFixtures();
	fixtures.push(fixture);
	return fixture;
}

function extract(pdfPath: string, outputPath: string | undefined): { output: Record<string, unknown>; stdout: string } {
	const args = [scriptPath, pdfPath, '1', '--skip-render'];
	if (outputPath) args.push('--output', outputPath);
	const result = spawnSync('python3', args, { encoding: 'utf-8' });
	expect(result.status, result.stderr).toBe(0);
	const outputMatch = result.stdout.match(/已输出 JSON：(.*)/);
	expect(outputMatch).not.toBeNull();
	const actualOutputPath = outputPath ?? outputMatch?.[1]?.trim();
	expect(actualOutputPath).toBeTruthy();
	generatedOutputs.push(actualOutputPath as string);
	return {
		output: JSON.parse(readFileSync(actualOutputPath as string, 'utf-8')) as Record<string, unknown>,
		stdout: result.stdout,
	};
}

afterEach(() => {
	for (const fixture of fixtures.splice(0)) fixture.cleanup();
	for (const outputPath of generatedOutputs.splice(0)) rmSync(outputPath, { force: true });
});

describe('read_pdf.py 提取包', () => {
	it('为含文字层的 PDF 输出版本化的逐页提取包', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'text-result.json');
		const { output } = extract(fixture.textPdf, outputPath);
		const source = output.source as Record<string, unknown>;
		const extractor = output.extractor as Record<string, unknown>;
		const pages = output.pages as Array<Record<string, unknown>>;
		const firstPage = pages[0];
		const blocks = firstPage.blocks as Array<Record<string, unknown>>;

		expect(output.schema_version).toBe(1);
		expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(source.mtime).toEqual(expect.any(String));
		expect(extractor.name).toBe('lifeos-read-pdf');
		expect(pages[0].pdf_page_index).toBe(1);
		expect(pages[0].printed_page_label).toBeNull();
		expect(blocks[0].kind).toBe('text');
		expect(firstPage.status).toBe('complete');
	});

	it('将没有文字层的页面标记为需要 OCR，而不是完整页面', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'no-text-result.json');
		const { output } = extract(fixture.noTextLayerPdf, outputPath);
		const page = (output.pages as Array<Record<string, unknown>>)[0];

		expect(page.status).toBe('needs_ocr');
		expect(page.coverage).toBe(0);
		expect(page.errors).toEqual([expect.stringMatching(/^TEXT_LAYER_MISSING$/)]);
	});

	it('将页脚中可验证的印刷页码与物理 PDF 页序分开输出', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'printed-label-result.json');
		const result = spawnSync('python3', [scriptPath, fixture.printedLabelPdf, '10', '--skip-render', '--output', outputPath], {
			encoding: 'utf-8',
		});
		expect(result.status, result.stderr).toBe(0);
		generatedOutputs.push(outputPath);
		const page = (JSON.parse(readFileSync(outputPath, 'utf-8')) as { pages: Array<Record<string, unknown>> }).pages[0];

		expect(page.pdf_page_index).toBe(10);
		expect(page.printed_page_label).toBe('1');
	});

	it('默认输出文件名包含微秒和来源摘要前缀', () => {
		const fixture = createFixtures();
		const { stdout } = extract(fixture.textPdf, undefined);
		const outputPath = stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim() ?? '';

		expect(outputPath).toMatch(/read-pdf-\d{8}-\d{6}-\d{6}-[a-f0-9]{8}\.json$/);
		expect(existsSync(outputPath)).toBe(true);
	});
});
