import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT_PATH = join(
	process.cwd(),
	'assets',
	'skills',
	'digest',
	'references',
	'rss-arxiv-script.py',
);

function runPython(code: string): string {
	const result = spawnSync('python3', ['-c', code], { encoding: 'utf-8' });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `python exited with ${result.status}`);
	}
	return result.stdout.trim();
}

describe('digest rss-arxiv script', () => {
	test('localizes helper messages and author suffixes', () => {
		const output = runPython(`
import importlib.util, json
spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
payload = {
    "zh_untitled": module.get_messages("zh")["untitled"],
    "en_untitled": module.get_messages("en")["untitled"],
    "zh_authors": module.format_authors(["Ada", "Linus", "Grace", "Alan"], "zh"),
    "en_authors": module.format_authors(["Ada", "Linus", "Grace", "Alan"], "en"),
}
print(json.dumps(payload, ensure_ascii=False))
`);

		expect(JSON.parse(output)).toEqual({
			zh_untitled: '无标题',
			en_untitled: 'Untitled',
			zh_authors: 'Ada, Linus, Grace 等',
			en_authors: 'Ada, Linus, Grace et al.',
		});
	});

	test('keeps the top-level JSON contract stable for an empty config', () => {
		const result = spawnSync('python3', [SCRIPT_PATH], {
			encoding: 'utf-8',
			input: JSON.stringify({
				language: 'en',
				rss: { enabled: false },
				arxiv: { enabled: false },
				days: 7,
			}),
		});

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			rss_articles: [],
			arxiv_papers: [],
			stats: {
				rss_count: 0,
				arxiv_count: 0,
			},
		});
	});
});
