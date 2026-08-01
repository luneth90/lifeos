import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type PdfFixtures, createPdfFixtures } from './helpers/pdf-fixtures.js';

const scriptPath = join(
	process.cwd(),
	'assets',
	'skills',
	'read-pdf',
	'scripts',
	'crop_pdf_region.py',
);
const fixtures: PdfFixtures[] = [];

function createFixtures(): PdfFixtures {
	const fixture = createPdfFixtures();
	fixtures.push(fixture);
	return fixture;
}

function runCrop(args: string[]) {
	return spawnSync('python3', [scriptPath, ...args], { encoding: 'utf-8' });
}

function errorCode(result: ReturnType<typeof runCrop>): string {
	expect(result.status).not.toBe(0);
	expect(result.stdout).toBe('');
	const payload = JSON.parse(result.stderr) as {
		ok: boolean;
		error: { code: string; message: string };
	};
	expect(payload.ok).toBe(false);
	expect(payload.error.message).toEqual(expect.any(String));
	return payload.error.code;
}

afterEach(() => {
	for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe('crop_pdf_region.py', () => {
	it('按 PDF point 边界而非整页渲染确定尺寸的 PNG', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'formula-crop.png');
		const result = runCrop([
			fixture.formulaImagePdf,
			'1',
			'--bbox',
			'72',
			'150',
			'540',
			'250',
			'--padding',
			'0',
			'--dpi',
			'144',
			'--output',
			outputPath,
		]);

		expect(result.status, result.stderr).toBe(0);
		const payload = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(payload).toMatchObject({
			ok: true,
			page: 1,
			requested_bbox: { x0: 72, y0: 150, x1: 540, y1: 250 },
			effective_bbox: { x0: 72, y0: 150, x1: 540, y1: 250 },
			padding: 0,
			dpi: 144,
			width: 936,
			height: 200,
		});
		expect(existsSync(outputPath)).toBe(true);
		expect(payload.output).toBe(realpathSync(outputPath));
		expect(payload.sha256).toBe(
			createHash('sha256').update(readFileSync(outputPath)).digest('hex'),
		);
	});

	it('将 padding 限制在页面边界内', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'clipped-padding.png');
		const result = runCrop([
			fixture.formulaImagePdf,
			'1',
			'--bbox',
			'5',
			'5',
			'20',
			'20',
			'--padding',
			'12',
			'--dpi',
			'144',
			'--output',
			outputPath,
		]);

		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			requested_bbox: { x0: 5, y0: 5, x1: 20, y1: 20 },
			effective_bbox: { x0: 0, y0: 0, x1: 32, y1: 32 },
			padding: 12,
		});
	});

	it.each(['0', '2'])('拒绝越界物理页码：%s', (page) => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, `page-${page}.png`);
		const result = runCrop([
			fixture.formulaImagePdf,
			page,
			'--bbox',
			'72',
			'150',
			'540',
			'250',
			'--output',
			outputPath,
		]);

		expect(errorCode(result)).toBe('PAGE_OUT_OF_RANGE');
		expect(existsSync(outputPath)).toBe(false);
	});

	it.each([
		['退化边界', ['72', '150', '72', '250']],
		['非有限边界', ['nan', '150', '540', '250']],
		['完全位于页面外', ['700', '150', '740', '250']],
	])('拒绝%s', (_name, bbox) => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'invalid-bbox.png');
		const result = runCrop([
			fixture.formulaImagePdf,
			'1',
			'--bbox',
			...bbox,
			'--output',
			outputPath,
		]);

		expect(errorCode(result)).toBe('INVALID_BBOX');
		expect(existsSync(outputPath)).toBe(false);
	});

	it.each(['-1', '145'])('拒绝非法 padding：%s', (padding) => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'invalid-padding.png');
		const result = runCrop([
			fixture.formulaImagePdf,
			'1',
			'--bbox',
			'72',
			'150',
			'540',
			'250',
			'--padding',
			padding,
			'--output',
			outputPath,
		]);

		expect(errorCode(result)).toBe('INVALID_PADDING');
		expect(existsSync(outputPath)).toBe(false);
	});

	it.each(['71', '601'])('拒绝非法 DPI：%s', (dpi) => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'invalid-dpi.png');
		const result = runCrop([
			fixture.formulaImagePdf,
			'1',
			'--bbox',
			'72',
			'150',
			'540',
			'250',
			'--dpi',
			dpi,
			'--output',
			outputPath,
		]);

		expect(errorCode(result)).toBe('INVALID_DPI');
		expect(existsSync(outputPath)).toBe(false);
	});

	it('拒绝非 PNG 输出', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'crop.jpg');
		const result = runCrop([
			fixture.formulaImagePdf,
			'1',
			'--bbox',
			'72',
			'150',
			'540',
			'250',
			'--output',
			outputPath,
		]);

		expect(errorCode(result)).toBe('INVALID_OUTPUT');
		expect(existsSync(outputPath)).toBe(false);
	});

	it('写入失败时不遗留临时文件', () => {
		const fixture = createFixtures();
		const parentFile = join(fixture.workspace, 'ordinary-file');
		writeFileSync(parentFile, 'not a directory');
		const before = readdirSync(fixture.workspace);
		const result = runCrop([
			fixture.formulaImagePdf,
			'1',
			'--bbox',
			'72',
			'150',
			'540',
			'250',
			'--output',
			join(parentFile, 'crop.png'),
		]);

		expect(errorCode(result)).toBe('WRITE_FAILED');
		expect(readdirSync(fixture.workspace)).toEqual(before);
	});

	it('参数校验失败时不覆盖已有目标', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'sentinel.png');
		writeFileSync(outputPath, 'sentinel');
		const result = runCrop([
			fixture.formulaImagePdf,
			'1',
			'--bbox',
			'72',
			'150',
			'72',
			'250',
			'--output',
			outputPath,
		]);

		expect(errorCode(result)).toBe('INVALID_BBOX');
		expect(readFileSync(outputPath, 'utf-8')).toBe('sentinel');
		expect(readdirSync(fixture.workspace).filter((name) => name.endsWith('.tmp'))).toEqual([]);
	});
});
