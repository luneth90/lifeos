import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractPlaceholders } from '../skill-contracts/helpers.js';
import { type PdfFixtures, createPdfFixtures } from './helpers/pdf-fixtures.js';

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
		output: JSON.parse(readFileSync(actualOutputPath as string, 'utf-8')) as Record<
			string,
			unknown
		>,
		stdout: result.stdout,
	};
}

afterEach(() => {
	for (const fixture of fixtures.splice(0)) fixture.cleanup();
	for (const generatedPath of generatedPaths.splice(0))
		rmSync(generatedPath, { force: true, recursive: true });
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

		expect(output.schema_version).toBe(2);
		expect(source.path).toBe('text-layer.pdf');
		expect(JSON.stringify(output)).not.toContain(fixture.workspace);
		expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(source.mtime).toEqual(expect.any(String));
		expect(extractor.name).toBe('lifeos-read-pdf');
		expect(extractor.version).toBe('2');
		expect(output.requested_pages).toEqual([1]);
		expect(pages[0].pdf_page_index).toBe(1);
		expect(pages[0].printed_page_label).toBeNull();
		expect(firstPage.page_size).toEqual({ width: 595, height: 842 });
		expect(blocks[0].kind).toBe('text');
		const textBbox = blocks[0].bbox as Record<string, number>;
		expect(textBbox.x0).toBeCloseTo(72, 5);
		expect(textBbox.y0).toBeCloseTo(59.1, 5);
		expect(textBbox.x1).toBeCloseTo(231.39597, 5);
		expect(textBbox.y1).toBeCloseTo(75.588, 5);
		expect(firstPage.status).toBe('complete');
	});

	it('将没有文字层的页面标记为需要 OCR，而不是完整页面', () => {
		const fixture = createFixtures();
		const { output } = extract(
			fixture.noTextLayerPdf,
			join(fixture.workspace, 'no-text-result.json'),
		);
		const page = (output.pages as Array<Record<string, unknown>>)[0];

		expect(page.status).toBe('needs_ocr');
		expect(page.coverage).toBe(0);
		expect(page.errors).toEqual([expect.stringMatching(/^TEXT_LAYER_MISSING$/)]);
	});

	it('将页脚中可验证的印刷页码与物理 PDF 页序分开输出', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'printed-label-result.json');
		const result = runScript([
			fixture.printedLabelPdf,
			'10',
			'--skip-render',
			'--output',
			outputPath,
		]);
		expect(result.status, result.stderr).toBe(0);
		generatedPaths.push(outputPath);
		const page = (
			JSON.parse(readFileSync(outputPath, 'utf-8')) as { pages: Array<Record<string, unknown>> }
		).pages[0];

		expect(page.pdf_page_index).toBe(10);
		expect(page.printed_page_label).toBe('1');
	});

	it('保留离散 target 的精确请求页而不把中间页误称为已请求', () => {
		const fixture = createFixtures();
		const { output } = extract(
			fixture.sparsePagesPdf,
			join(fixture.workspace, 'sparse-result.json'),
			'1,3',
		);

		expect(output.requested_pages).toEqual([1, 3]);
		expect(output.requested_range).toEqual({ start: 1, end: 3 });
		expect(
			(output.pages as Array<Record<string, unknown>>).map((page) => page.pdf_page_index),
		).toEqual([1, 3]);
	});

	it('以真实位图公式的有序 blocks 标记部分页面并保留默认渲染目录', () => {
		const fixture = createFixtures();
		const result = runScript([fixture.formulaImagePdf, '1']);
		expect(result.status, result.stderr).toBe(0);
		const outputPath = result.stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim();
		expect(outputPath).toBeTruthy();
		generatedPaths.push(outputPath as string);
		const output = JSON.parse(readFileSync(outputPath as string, 'utf-8')) as Record<
			string,
			unknown
		>;
		const page = (output.pages as Array<Record<string, unknown>>)[0];
		const rendered = output.rendered_images as Array<Record<string, unknown>>;

		const blocks = page.blocks as Array<Record<string, unknown>>;
		expect(blocks.map((block) => block.kind)).toEqual([
			'text',
			'image',
			'text',
		]);
		expect(blocks.find((block) => block.kind === 'image')?.bbox).toEqual({
			x0: 72,
			y0: 150,
			x1: 540,
			y1: 250,
		});
		expect(page.status).toBe('partial');
		expect(page.errors).toEqual(['VISUAL_CONTENT_PENDING']);
		expect(output.summary).toMatchObject({ partial_pages: 1 });
		expect(existsSync(rendered[0].path as string)).toBe(true);
		generatedPaths.push(join(rendered[0].path as string, '..'));
	});

	it('将含文字的矢量图表标记为待视觉补充并渲染', () => {
		const fixture = createFixtures();
		const result = runScript([fixture.vectorVisualPdf, '1']);
		expect(result.status, result.stderr).toBe(0);
		const outputPath = result.stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim();
		expect(outputPath).toBeTruthy();
		generatedPaths.push(outputPath as string);
		const output = JSON.parse(readFileSync(outputPath as string, 'utf-8')) as {
			pages: Array<{
				status: string;
				errors: string[];
				blocks: Array<{ kind: string; bbox: Record<string, number> }>;
			}>;
			rendered_images: Array<{ page: number; path: string }>;
		};

		expect(output.pages[0].status).toBe('partial');
		expect(output.pages[0].errors).toContain('VISUAL_CONTENT_PENDING');
		expect(output.pages[0].blocks.map((block) => block.kind)).toContain('image');
		expect(output.pages[0].blocks.find((block) => block.kind === 'image')?.bbox).toEqual({
			x0: 72,
			y0: 120,
			x1: 278,
			y1: 300,
		});
		expect(output.rendered_images.map((image) => image.page)).toEqual([1]);
		expect(existsSync(output.rendered_images[0].path)).toBe(true);
		generatedPaths.push(join(output.rendered_images[0].path, '..'));
	});

	it('将三格无填充矢量图标记为待视觉补充的单一页级占位', () => {
		const fixture = createFixtures();
		const result = runScript([fixture.unfilledVectorPdf, '1']);
		expect(result.status, result.stderr).toBe(0);
		const outputPath = result.stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim();
		expect(outputPath).toBeTruthy();
		generatedPaths.push(outputPath as string);
		const output = JSON.parse(readFileSync(outputPath as string, 'utf-8')) as {
			pages: Array<{ status: string; blocks: Array<{ kind: string }> }>;
			rendered_images: Array<{ page: number; path: string }>;
		};

		expect(output.pages[0].status).toBe('partial');
		expect(output.pages[0].blocks.filter((block) => block.kind === 'image')).toHaveLength(1);
		expect(output.rendered_images.map((image) => image.page)).toEqual([1]);
		expect(existsSync(output.rendered_images[0].path)).toBe(true);
		generatedPaths.push(join(output.rendered_images[0].path, '..'));
	});

	it('将含内部横纵分隔线的无填充网格标记为待视觉补充', () => {
		const fixture = createFixtures();
		const result = runScript([fixture.unfilledVectorPdf, '2']);
		expect(result.status, result.stderr).toBe(0);
		const outputPath = result.stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim();
		expect(outputPath).toBeTruthy();
		generatedPaths.push(outputPath as string);
		const output = JSON.parse(readFileSync(outputPath as string, 'utf-8')) as {
			pages: Array<{ status: string; blocks: Array<{ kind: string }> }>;
			rendered_images: Array<{ page: number; path: string }>;
		};

		expect(output.pages[0].status).toBe('partial');
		expect(output.pages[0].blocks.filter((block) => block.kind === 'image')).toHaveLength(1);
		expect(output.rendered_images.map((image) => image.page)).toEqual([2]);
		expect(existsSync(output.rendered_images[0].path)).toBe(true);
		generatedPaths.push(join(output.rendered_images[0].path, '..'));
	});

	it.each([
		['独立 re 外框加内部线', 3],
		['同一 Shape 内的 re 外框加内部线', 4],
		['同一 Shape 内的六条边线', 7],
		['同一 Shape 内的线框加内部线', 9],
		['re 外框加两条内部竖线及 58 条不相交刻线', 12],
		['四条独立边线外框加两条内部竖线及 59 条不相交刻线', 13],
		['外框与内分隔线端点相差 1pt 并附加 58 条不相交刻线', 14],
		['外框与内分隔线端点相差 1pt 并附加 59 条不相交刻线', 15],
		['竖边向外延伸 20pt 并附加 58 条不相交刻线', 16],
		['竖边向外延伸 20pt 并附加 59 条不相交刻线', 17],
		['横边两端各短 1pt 并附加 58 条不相交刻线', 18],
		['横边两端各短 1pt 并附加 59 条不相交刻线', 19],
		['内竖线端点邻近空间不相交刻线并另附 56 条刻线', 20],
		['内竖线端点邻近空间不相交刻线并另附 57 条刻线', 21],
		['内竖线端点短刻线包围共同内层边对并另附 54 条刻线', 22],
		['内竖线端点短刻线包围共同内层边对并另附 55 条刻线', 23],
		['横纵双向不相邻噪声隐藏共同边对并另附 46 条刻线', 24],
		['横纵双向不相邻噪声隐藏共同边对并另附 47 条刻线', 25],
	])('将%s编码的等价网格标记为待视觉补充', (_description, page) => {
		const fixture = createFixtures();
		const result = runScript([fixture.unfilledVectorPdf, String(page)]);
		expect(result.status, result.stderr).toBe(0);
		const outputPath = result.stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim();
		expect(outputPath).toBeTruthy();
		generatedPaths.push(outputPath as string);
		const output = JSON.parse(readFileSync(outputPath as string, 'utf-8')) as {
			pages: Array<{ status: string; blocks: Array<{ kind: string }> }>;
			rendered_images: Array<{ page: number; path: string }>;
		};

		expect(output.pages[0].status).toBe('partial');
		expect(output.pages[0].blocks.filter((block) => block.kind === 'image')).toHaveLength(1);
		expect(output.rendered_images.map((image) => image.page)).toEqual([page]);
		expect(existsSync(output.rendered_images[0].path)).toBe(true);
		generatedPaths.push(join(output.rendered_images[0].path, '..'));
	});

	it.each([
		['十二条独立边线', 5],
		['同一 Shape 内的三个 re', 6],
		['同一 Shape 内的十二条边线', 8],
		['三个 re 加 52 条不相交刻线', 10],
		['三个 re 加 53 条不相交刻线', 11],
	])('将%s编码的三个等价框标记为待视觉补充', (_description, page) => {
		const fixture = createFixtures();
		const result = runScript([fixture.unfilledVectorPdf, String(page)]);
		expect(result.status, result.stderr).toBe(0);
		const outputPath = result.stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim();
		expect(outputPath).toBeTruthy();
		generatedPaths.push(outputPath as string);
		const output = JSON.parse(readFileSync(outputPath as string, 'utf-8')) as {
			pages: Array<{ status: string; blocks: Array<{ kind: string }> }>;
			rendered_images: Array<{ page: number; path: string }>;
		};

		expect(output.pages[0].status).toBe('partial');
		expect(output.pages[0].blocks.filter((block) => block.kind === 'image')).toHaveLength(1);
		expect(output.rendered_images.map((image) => image.page)).toEqual([page]);
		expect(existsSync(output.rendered_images[0].path)).toBe(true);
		generatedPaths.push(join(output.rendered_images[0].path, '..'));
	});

	it('不把普通分隔线和页框误判为待补充的矢量图表', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'decorative-vector-result.json');
		const result = runScript([fixture.decorativeVectorPdf, '1', '--output', outputPath]);
		expect(result.status, result.stderr).toBe(0);
		generatedPaths.push(outputPath);
		const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as {
			pages: Array<{ status: string; blocks: Array<{ kind: string }> }>;
			rendered_images?: Array<{ page: number; path: string }>;
		};

		expect(output.pages[0].status).toBe('complete');
		expect(output.pages[0].blocks.map((block) => block.kind)).toEqual(['text']);
		expect(output).not.toHaveProperty('rendered_images');
	});

	it.each([
		['同一路径内的平行装饰线', 2],
		['由四条独立边线组成的页框', 3],
		['由四条独立边线组成的内嵌框', 4],
		['由同一 Shape 编码的等价内嵌框', 5],
		['由单一 re 编码的等价内嵌框', 8],
		['由 32 条横线与 32 条竖线组成的两簇不相交刻线', 9],
		['由 33 条横线与 32 条竖线组成的两簇不相交刻线', 10],
	])('不把%s误判为待补充的矢量图表', (_description, page) => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, `decorative-vector-page-${page}.json`);
		const result = runScript([fixture.decorativeVectorPdf, String(page), '--output', outputPath]);
		expect(result.status, result.stderr).toBe(0);
		generatedPaths.push(outputPath);
		const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as {
			pages: Array<{ status: string; blocks: Array<{ kind: string }> }>;
			rendered_images?: Array<{ page: number; path: string }>;
		};

		expect(output.pages[0].status).toBe('complete');
		expect(output.pages[0].blocks.map((block) => block.kind)).toEqual(['text']);
		expect(output).not.toHaveProperty('rendered_images');
	});

	it.each([
		['三条独立边线', 6],
		['同一 Shape', 7],
	])('将%s编码的等价三角形标记为待视觉补充', (_description, page) => {
		const fixture = createFixtures();
		const result = runScript([fixture.decorativeVectorPdf, String(page)]);
		expect(result.status, result.stderr).toBe(0);
		const outputPath = result.stdout.match(/已输出 JSON：(.*)/)?.[1]?.trim();
		expect(outputPath).toBeTruthy();
		generatedPaths.push(outputPath as string);
		const output = JSON.parse(readFileSync(outputPath as string, 'utf-8')) as {
			pages: Array<{ status: string; blocks: Array<{ kind: string }> }>;
			rendered_images: Array<{ page: number; path: string }>;
		};

		expect(output.pages[0].status).toBe('partial');
		expect(output.pages[0].blocks.filter((block) => block.kind === 'image')).toHaveLength(1);
		expect(output.rendered_images.map((image) => image.page)).toEqual([page]);
		expect(existsSync(output.rendered_images[0].path)).toBe(true);
		generatedPaths.push(join(output.rendered_images[0].path, '..'));
	});

	it('在单轴稠密装饰线下不会进入无界矩形组合搜索', () => {
		const program = [
			'import importlib.util, sys, fitz',
			'spec = importlib.util.spec_from_file_location("lifeos_read_pdf", sys.argv[1])',
			'module = importlib.util.module_from_spec(spec)',
			'sys.modules[spec.name] = module',
			'spec.loader.exec_module(module)',
			'class FakePage:',
			'    rect = fitz.Rect(0, 0, 600, 7000)',
			'    def get_drawings(self):',
			'        return [{"rect": fitz.Rect(50, y, 550, y), "items": [("l", fitz.Point(50, y), fitz.Point(550, y))], "fill": None} for y in range(1, 6001)]',
			'print(module.vector_visual_bbox(FakePage()))',
		].join('\n');
		const result = spawnSync('python3', ['-c', program, scriptPath], {
			encoding: 'utf-8',
			timeout: 1000,
		});

		expect(result.status, result.error?.message ?? result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe('None');
	});

	it('在双轴稠密但不相交的装饰线下保持有界搜索', () => {
		const program = [
			'import importlib.util, sys, fitz',
			'spec = importlib.util.spec_from_file_location("lifeos_read_pdf", sys.argv[1])',
			'module = importlib.util.module_from_spec(spec)',
			'sys.modules[spec.name] = module',
			'spec.loader.exec_module(module)',
			'class FakePage:',
			'    rect = fitz.Rect(0, 0, 4000, 4000)',
			'    def get_drawings(self):',
			'        horizontal = [{"rect": fitz.Rect(50, y, 550, y), "items": [("l", fitz.Point(50, y), fitz.Point(550, y))], "fill": None} for y in range(1, 3001)]',
			'        vertical = [{"rect": fitz.Rect(x, 3200, x, 3800), "items": [("l", fitz.Point(x, 3200), fitz.Point(x, 3800))], "fill": None} for x in range(700, 3700)]',
			'        return horizontal + vertical',
			'print(module.vector_visual_bbox(FakePage()))',
		].join('\n');
		const result = spawnSync('python3', ['-c', program, scriptPath], {
			encoding: 'utf-8',
			timeout: 1000,
		});

		expect(result.status, result.error?.message ?? result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe('None');
	});

	it('在双轴全相交的稠密网格中保持有界并失败关闭', () => {
		const program = [
			'import importlib.util, sys, fitz',
			'spec = importlib.util.spec_from_file_location("lifeos_read_pdf", sys.argv[1])',
			'module = importlib.util.module_from_spec(spec)',
			'sys.modules[spec.name] = module',
			'spec.loader.exec_module(module)',
			'class FakePage:',
			'    count = 3000',
			'    rect = fitz.Rect(0, 0, 4000, 4000)',
			'    def get_drawings(self):',
			'        count = self.count',
			'        positions = [100, 700, 1300, 1900] + [2000 + index * 0.5 for index in range(count - 4)]',
			'        horizontal = [{"rect": fitz.Rect(0, y, 3500, y), "items": [("l", fitz.Point(0, y), fitz.Point(3500, y))], "fill": None} for y in positions]',
			'        vertical = [{"rect": fitz.Rect(x, 0, x, 3500), "items": [("l", fitz.Point(x, 0), fitz.Point(x, 3500))], "fill": None} for x in positions]',
			'        return horizontal + vertical',
			'print(module.vector_visual_bbox(FakePage()))',
		].join('\n');
		const result = spawnSync('python3', ['-c', program, scriptPath], {
			encoding: 'utf-8',
			timeout: 1000,
		});

		expect(result.status, result.error?.message ?? result.stderr).toBe(0);
		expect(result.stdout.trim()).not.toBe('None');
	});

	it('在横纵合计越过全局匹配预算时保持有界并失败关闭', () => {
		const program = [
			'import importlib.util, sys, fitz',
			'spec = importlib.util.spec_from_file_location("lifeos_read_pdf", sys.argv[1])',
			'module = importlib.util.module_from_spec(spec)',
			'sys.modules[spec.name] = module',
			'spec.loader.exec_module(module)',
			'class FakePage:',
			'    count = 26000',
			'    rect = fitz.Rect(0, 0, count * 10 + 20, count * 10 + 20)',
			'    def get_drawings(self):',
			'        positions = [index * 10 + 5 for index in range(self.count)]',
			'        horizontal = [{"rect": fitz.Rect(value - 2, value, value + 2, value), "items": [("l", fitz.Point(value - 2, value), fitz.Point(value + 2, value))], "fill": None} for value in positions]',
			'        vertical = [{"rect": fitz.Rect(value, value - 2, value, value + 2), "items": [("l", fitz.Point(value, value - 2), fitz.Point(value, value + 2))], "fill": None} for value in positions]',
			'        return horizontal + vertical',
			'print(module.vector_visual_bbox(FakePage()))',
		].join('\n');
		const result = spawnSync('python3', ['-c', program, scriptPath], {
			encoding: 'utf-8',
			timeout: 4000,
		});

		expect(result.status, result.error?.message ?? result.stderr).toBe(0);
		expect(result.stdout.trim()).not.toBe('None');
	});

	it('在共享长边且跨度各异的无单元格输入下保持次二次复杂度', () => {
		const program = [
			'import importlib.util, sys, fitz',
			'spec = importlib.util.spec_from_file_location("lifeos_read_pdf", sys.argv[1])',
			'module = importlib.util.module_from_spec(spec)',
			'sys.modules[spec.name] = module',
			'spec.loader.exec_module(module)',
			'class FakePage:',
			'    count = 3000',
			'    rect = fitz.Rect(0, 0, count * 16 + 200, count * 5 + 20)',
			'    def get_drawings(self):',
			'        count = self.count',
			'        shared = [{"rect": fitz.Rect(index * 8, 0, index * 8 + 4, 0), "items": [("l", fitz.Point(index * 8, 0), fitz.Point(index * 8 + 4, 0))], "fill": None} for index in range(count)]',
			'        ends = []',
			'        sides = []',
			'        for index in range(count):',
			'            x = count * 8 + 100 + index * 8',
			'            y = 10 + index * 5',
			'            ends.append({"rect": fitz.Rect(x - 2, y, x + 2, y), "items": [("l", fitz.Point(x - 2, y), fitz.Point(x + 2, y))], "fill": None})',
			'            sides.append({"rect": fitz.Rect(x, 0, x, y), "items": [("l", fitz.Point(x, 0), fitz.Point(x, y))], "fill": None})',
			'        return shared + ends + sides',
			'print(module.vector_visual_bbox(FakePage()))',
		].join('\n');
		const result = spawnSync('python3', ['-c', program, scriptPath], {
			encoding: 'utf-8',
			timeout: 1500,
		});

		expect(result.status, result.error?.message ?? result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe('None');
	});

	it('默认只渲染需要视觉补充的页面', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'text-with-render-default.json');
		const result = runScript([fixture.textPdf, '1', '--output', outputPath]);
		expect(result.status, result.stderr).toBe(0);
		generatedPaths.push(outputPath);
		const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;

		expect(output).not.toHaveProperty('rendered_images');
		expect(readdirSync(fixture.workspace).filter((name) => name.includes('-images-'))).toEqual([]);
	});

	it('混合页面只渲染待补充页并保留精确页码', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'mixed-render-result.json');
		const result = runScript([fixture.mixedVisualPdf, '1-2', '--output', outputPath]);
		expect(result.status, result.stderr).toBe(0);
		generatedPaths.push(outputPath);
		const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as {
			pages: Array<{ status: string }>;
			rendered_images: Array<{ page: number; path: string }>;
		};

		expect(output.pages.map((page) => page.status)).toEqual(['complete', 'partial']);
		expect(output.rendered_images.map((image) => image.page)).toEqual([2]);
		expect(existsSync(output.rendered_images[0].path)).toBe(true);
		generatedPaths.push(join(output.rendered_images[0].path, '..'));
	});

	it('支持安全的 Vault 相对 source-label', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'source-label-result.json');
		const result = runScript([
			fixture.textPdf,
			'1',
			'--skip-render',
			'--source-label',
			'70_资源/书籍/代数.pdf',
			'--output',
			outputPath,
		]);
		expect(result.status, result.stderr).toBe(0);
		generatedPaths.push(outputPath);
		const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as {
			source: { path: string };
		};

		expect(output.source.path).toBe('70_资源/书籍/代数.pdf');
		expect(JSON.stringify(output)).not.toContain(fixture.workspace);
	});

	it.each(['70_资源/👩‍💻.pdf', '70_资源/a\u200cb.pdf', '70_资源/\ue000.pdf'])(
		'支持不会隐藏路径的 Unicode source-label：%s',
		(sourceLabel) => {
			const fixture = createFixtures();
			const outputPath = join(fixture.workspace, 'unicode-label-result.json');
			const result = runScript([
				fixture.textPdf,
				'1',
				'--skip-render',
				'--source-label',
				sourceLabel,
				'--output',
				outputPath,
			]);

			expect(result.status, result.stderr).toBe(0);
			generatedPaths.push(outputPath);
			const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as {
				source: { path: string };
			};
			expect(output.source.path).toBe(sourceLabel);
		},
	);

	it.each([
		'',
		'/tmp/leak.pdf',
		' /tmp/leak.pdf',
		'../leak.pdf',
		'books/../leak.pdf',
		'./leak.pdf',
		'C:\\leak.pdf',
		'file:/Users/alice/leak.pdf',
		'／Users/alice/leak.pdf',
		'\u200b/Users/alice/leak.pdf',
		'\u2060/Users/alice/leak.pdf',
		'\u202e/Users/alice/leak.pdf',
		'\u200d/Users/alice/leak.pdf',
		'books/\u200dleak.pdf',
		'70_资源/a\u200d b.pdf',
		'70_资源/a \u200db.pdf',
		'70_资源/a\u200c b.pdf',
		'70_资源/a \u200cb.pdf',
		'70_资源/a\u200d\u00a0b.pdf',
		'70_资源/a\u200c\u202fb.pdf',
		'70_资源/a\u200d\u3000b.pdf',
		'70_资源/a\u200c\u2028b.pdf',
	])('拒绝不安全的 source-label：%s', (sourceLabel) => {
		const fixture = createFixtures();
		const result = runScript([
			fixture.textPdf,
			'1',
			'--skip-render',
			'--source-label',
			sourceLabel,
			'--output',
			join(fixture.workspace, 'unsafe-label.json'),
		]);

		expect(result.status).toBe(2);
		expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: 'INVALID_SOURCE_LABEL' } });
	});

	it('为提取失败页生成视觉恢复所需的 PNG', () => {
		const fixture = createFixtures();
		const outputPath = join(fixture.workspace, 'failed-page-result.json');
		const program = [
			'import importlib.util, sys',
			'spec = importlib.util.spec_from_file_location("lifeos_read_pdf", sys.argv[1])',
			'module = importlib.util.module_from_spec(spec)',
			'sys.modules[spec.name] = module',
			'spec.loader.exec_module(module)',
			'def failed_page(_page, index):',
			'    return {"pdf_page_index": index, "printed_page_label": None, "status": "failed", "coverage": 0, "confidence": 0, "errors": ["EXTRACTION_FAILED"], "blocks": []}',
			'module.extract_page = failed_page',
			'sys.argv = [sys.argv[1], sys.argv[2], "1", "--output", sys.argv[3]]',
			'raise SystemExit(module.main())',
		].join('\n');
		const result = spawnSync('python3', ['-c', program, scriptPath, fixture.textPdf, outputPath], {
			encoding: 'utf-8',
		});

		expect(result.status, result.stderr).toBe(0);
		generatedPaths.push(outputPath);
		const output = JSON.parse(readFileSync(outputPath, 'utf-8')) as {
			pages: Array<{ status: string }>;
			rendered_images: Array<{ page: number; path: string }>;
		};
		expect(output.pages[0].status).toBe('failed');
		expect(output.rendered_images.map((image) => image.page)).toEqual([1]);
		expect(existsSync(output.rendered_images[0].path)).toBe(true);
		generatedPaths.push(join(output.rendered_images[0].path, '..'));
	});

	it('以分块读取计算 SHA-256，不依赖 Path.read_bytes', () => {
		const fixture = createFixtures();
		const program = [
			'import importlib.util, pathlib, sys',
			'spec = importlib.util.spec_from_file_location("lifeos_read_pdf", sys.argv[1])',
			'module = importlib.util.module_from_spec(spec)',
			'sys.modules[spec.name] = module',
			'spec.loader.exec_module(module)',
			'pathlib.Path.read_bytes = lambda self: (_ for _ in ()).throw(RuntimeError("read_bytes forbidden"))',
			'metadata = module.source_metadata(pathlib.Path(sys.argv[2]), 1, "safe.pdf")',
			'print(metadata["sha256"])',
		].join('\n');
		const result = spawnSync('python3', ['-c', program, scriptPath, fixture.textPdf], {
			encoding: 'utf-8',
		});

		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe(
			createHash('sha256').update(readFileSync(fixture.textPdf)).digest('hex'),
		);
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
		expect(
			readdirSync(fixture.workspace).filter((name) => name.startsWith('blocked-output-images-')),
		).toEqual([]);
	});

	it('将参数解析失败统一为机器可读错误 JSON', () => {
		const fixture = createFixtures();
		for (const args of [
			[],
			[fixture.textPdf, '1', '--dpi', 'bad'],
			[fixture.textPdf, '1', '--unknown-flag'],
		]) {
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
			const template = readFileSync(
				join(process.cwd(), 'assets', 'templates', language, 'Translation_Template.md'),
				'utf-8',
			);
			const skill = readFileSync(
				join(process.cwd(), 'assets', 'skills', 'translate', `SKILL.${language}.md`),
				'utf-8',
			);
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
