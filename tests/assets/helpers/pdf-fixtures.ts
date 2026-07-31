import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PdfFixtures {
	noTextLayerPdf: string;
	printedLabelPdf: string;
	textPdf: string;
	workspace: string;
	cleanup(): void;
}

export function createPdfFixtures(): PdfFixtures {
	const workspace = mkdtempSync(join(tmpdir(), 'lifeos-read-pdf-test-'));
	const textPdf = join(workspace, 'text-layer.pdf');
	const noTextLayerPdf = join(workspace, 'no-text-layer.pdf');
	const printedLabelPdf = join(workspace, 'printed-label.pdf');
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
	].join('\n');
	const result = spawnSync('python3', ['-c', program, textPdf, noTextLayerPdf, printedLabelPdf], {
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
		cleanup: () => rmSync(workspace, { force: true, recursive: true }),
	};
}
