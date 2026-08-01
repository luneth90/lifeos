import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PdfFixtures {
	decorativeVectorPdf: string;
	formulaImagePdf: string;
	mixedVisualPdf: string;
	noTextLayerPdf: string;
	printedLabelPdf: string;
	sparsePagesPdf: string;
	textPdf: string;
	unfilledVectorPdf: string;
	vectorVisualPdf: string;
	workspace: string;
	cleanup(): void;
}

export function createPdfFixtures(): PdfFixtures {
	const workspace = mkdtempSync(join(tmpdir(), 'lifeos-read-pdf-test-'));
	const textPdf = join(workspace, 'text-layer.pdf');
	const noTextLayerPdf = join(workspace, 'no-text-layer.pdf');
	const printedLabelPdf = join(workspace, 'printed-label.pdf');
	const formulaImagePdf = join(workspace, 'formula-image.pdf');
	const mixedVisualPdf = join(workspace, 'mixed-visual.pdf');
	const sparsePagesPdf = join(workspace, 'sparse-pages.pdf');
	const vectorVisualPdf = join(workspace, 'vector-visual.pdf');
	const decorativeVectorPdf = join(workspace, 'decorative-vector.pdf');
	const unfilledVectorPdf = join(workspace, 'unfilled-vector.pdf');
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
		'mixed = fitz.open()',
		'mixed_text_page = mixed.new_page()',
		"mixed_text_page.insert_text((72, 72), 'Complete text-only page.', fontsize=12)",
		'mixed_visual_page = mixed.new_page()',
		"mixed_visual_page.insert_text((72, 100), 'Page with formula.', fontsize=13)",
		'mixed_visual_page.insert_image(fitz.Rect(72, 150, 540, 250), filename=formula_image_path)',
		'mixed.save(sys.argv[6])',
		'mixed.close()',
		'sparse = fitz.open()',
		'for index in range(1, 4):',
		'    page = sparse.new_page()',
		"    page.insert_text((72, 72), f'Sparse page {index}', fontsize=12)",
		'sparse.save(sys.argv[5])',
		'sparse.close()',
		'vector = fitz.open()',
		'vector_page = vector.new_page()',
		"vector_page.insert_text((72, 72), 'Revenue by quarter', fontsize=12)",
		'vector_page.draw_rect(fitz.Rect(72, 120, 160, 300), color=(0, 0, 0), fill=(0.2, 0.4, 0.8))',
		'vector_page.draw_rect(fitz.Rect(190, 180, 278, 300), color=(0, 0, 0), fill=(0.8, 0.4, 0.2))',
		'vector.save(sys.argv[7])',
		'vector.close()',
		'decorative = fitz.open()',
		'decorative_page = decorative.new_page()',
		"decorative_page.insert_text((72, 72), 'Text with decorative rules only.', fontsize=12)",
		'decorative_page.draw_line(fitz.Point(72, 96), fitz.Point(520, 96), color=(0.5, 0.5, 0.5))',
		'decorative_page.draw_line(fitz.Point(72, 112), fitz.Point(520, 112), color=(0.5, 0.5, 0.5))',
		'decorative_page.draw_line(fitz.Point(72, 128), fitz.Point(520, 128), color=(0.5, 0.5, 0.5))',
		'decorative_page.draw_line(fitz.Point(72, 144), fitz.Point(520, 144), color=(0.5, 0.5, 0.5))',
		'decorative_page.draw_rect(fitz.Rect(72, 160, 520, 180), color=(0.2, 0.2, 0.2), fill=(0.9, 0.9, 0.9))',
		'decorative_page.draw_rect(fitz.Rect(36, 36, 559, 806), color=(0.7, 0.7, 0.7))',
		'grouped_rules_page = decorative.new_page()',
		"grouped_rules_page.insert_text((72, 72), 'Grouped decorative rules.', fontsize=12)",
		'grouped_rules = grouped_rules_page.new_shape()',
		'for y in (96, 112, 128, 144):',
		'    grouped_rules.draw_line(fitz.Point(72, y), fitz.Point(520, y))',
		'grouped_rules.finish(color=(0.5, 0.5, 0.5))',
		'grouped_rules.commit()',
		'split_frame_page = decorative.new_page()',
		"split_frame_page.insert_text((72, 72), 'Split page frame.', fontsize=12)",
		'split_frame_page.draw_line(fitz.Point(36, 36), fitz.Point(559, 36), color=(0.7, 0.7, 0.7))',
		'split_frame_page.draw_line(fitz.Point(559, 36), fitz.Point(559, 806), color=(0.7, 0.7, 0.7))',
		'split_frame_page.draw_line(fitz.Point(559, 806), fitz.Point(36, 806), color=(0.7, 0.7, 0.7))',
		'split_frame_page.draw_line(fitz.Point(36, 806), fitz.Point(36, 36), color=(0.7, 0.7, 0.7))',
		'decorative.save(sys.argv[8])',
		'decorative.close()',
		'unfilled = fitz.open()',
		'unfilled_page = unfilled.new_page()',
		"unfilled_page.insert_text((72, 72), 'Three-cell comparison diagram', fontsize=12)",
		'unfilled_page.draw_rect(fitz.Rect(72, 140, 200, 300), color=(0, 0, 0))',
		'unfilled_page.draw_rect(fitz.Rect(230, 140, 358, 300), color=(0, 0, 0))',
		'unfilled_page.draw_rect(fitz.Rect(388, 140, 516, 300), color=(0, 0, 0))',
		'unfilled_grid_page = unfilled.new_page()',
		"unfilled_grid_page.insert_text((72, 72), 'Internal comparison grid', fontsize=12)",
		'for y in (140, 220, 300):',
		'    unfilled_grid_page.draw_line(fitz.Point(72, y), fitz.Point(516, y), color=(0, 0, 0))',
		'for x in (72, 294, 516):',
		'    unfilled_grid_page.draw_line(fitz.Point(x, 140), fitz.Point(x, 300), color=(0, 0, 0))',
		'unfilled.save(sys.argv[9])',
		'unfilled.close()',
	].join('\n');
	const result = spawnSync(
		'python3',
		[
			'-c',
			program,
			textPdf,
			noTextLayerPdf,
			printedLabelPdf,
			formulaImagePdf,
			sparsePagesPdf,
			mixedVisualPdf,
			vectorVisualPdf,
			decorativeVectorPdf,
			unfilledVectorPdf,
		],
		{
			encoding: 'utf-8',
		},
	);
	if (result.status !== 0) {
		rmSync(workspace, { force: true, recursive: true });
		throw new Error(`无法生成 PDF 测试夹具：${result.stderr}`);
	}

	return {
		decorativeVectorPdf,
		workspace,
		textPdf,
		noTextLayerPdf,
		printedLabelPdf,
		formulaImagePdf,
		mixedVisualPdf,
		sparsePagesPdf,
		vectorVisualPdf,
		unfilledVectorPdf,
		cleanup: () => rmSync(workspace, { force: true, recursive: true }),
	};
}
