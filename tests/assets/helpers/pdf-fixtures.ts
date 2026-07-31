import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PdfFixtures {
	formulaImagePdf: string;
	noTextLayerPdf: string;
	printedLabelPdf: string;
	sparsePagesPdf: string;
	textPdf: string;
	workspace: string;
	cleanup(): void;
}

export function createPdfFixtures(): PdfFixtures {
	const workspace = mkdtempSync(join(tmpdir(), 'lifeos-read-pdf-test-'));
	const textPdf = join(workspace, 'text-layer.pdf');
	const noTextLayerPdf = join(workspace, 'no-text-layer.pdf');
	const printedLabelPdf = join(workspace, 'printed-label.pdf');
	const formulaImagePdf = join(workspace, 'formula-image.pdf');
	const sparsePagesPdf = join(workspace, 'sparse-pages.pdf');
	const program = [
		'import fitz, sys',
		'text_path, no_text_path = sys.argv[1:3]',
		'text = fitz.open()',
		'page = text.new_page()',
		"page.insert_text((72, 72), 'A real text layer for extraction.', fontsize=12)",
		'text.save(text_path)',
		'text.close()',
		'blank = fitz.open()',
		'blank.new_page()',
		'blank.save(no_text_path)',
		'blank.close()',
		'numbered = fitz.open()',
		'for index in range(1, 11):',
		'    page = numbered.new_page()',
		"    page.insert_text((72, 72), f'Physical page {index}', fontsize=12)",
		'    if index == 10:',
		"        page.insert_text((300, 760), '1', fontsize=12)",
		'numbered.save(sys.argv[3])',
		'numbered.close()',
		'formula_source = fitz.open()',
		'formula_source_page = formula_source.new_page(width=500, height=120)',
		"formula_source_page.insert_text((120, 72), 'E = mc^2', fontsize=36)",
		'formula_image = formula_source_page.get_pixmap()',
		'formula_image_path = sys.argv[4] + ".png"',
		'formula_image.save(formula_image_path)',
		'formula_source.close()',
		'formula = fitz.open()',
		'formula_page = formula.new_page()',
		"formula_page.insert_text((72, 100), 'Text before formula.', fontsize=13)",
		'formula_page.insert_image(fitz.Rect(72, 150, 540, 250), filename=formula_image_path)',
		"formula_page.insert_text((72, 300), 'Text after formula.', fontsize=13)",
		'formula.save(sys.argv[4])',
		'formula.close()',
		'sparse = fitz.open()',
		'for index in range(1, 4):',
		'    page = sparse.new_page()',
		"    page.insert_text((72, 72), f'Sparse page {index}', fontsize=12)",
		'sparse.save(sys.argv[5])',
		'sparse.close()',
	].join('\n');
	const result = spawnSync('python3', ['-c', program, textPdf, noTextLayerPdf, printedLabelPdf, formulaImagePdf, sparsePagesPdf], {
		encoding: 'utf-8',
	});
	if (result.status !== 0) {
		rmSync(workspace, { force: true, recursive: true });
		throw new Error(`无法生成 PDF 测试夹具：${result.stderr}`);
	}

	return {
		workspace,
		textPdf,
		noTextLayerPdf,
		printedLabelPdf,
		formulaImagePdf,
		sparsePagesPdf,
		cleanup: () => rmSync(workspace, { force: true, recursive: true }),
	};
}
