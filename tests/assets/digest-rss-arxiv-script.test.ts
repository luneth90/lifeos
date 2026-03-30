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

function runPythonJson(code: string): unknown {
	return JSON.parse(runPython(code));
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
			errors: [],
		});
	});

	test('normalizes OpenAlex arXiv links and rejects non-arXiv fallback records', () => {
		const output = runPythonJson(`
import importlib.util, json
spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

normalizer = getattr(module, "normalize_openalex_arxiv_link", None)
if normalizer is None:
    payload = {"from_ids": None, "from_locations": None, "non_arxiv": None}
else:
    payload = {
        "from_ids": normalizer({
            "ids": {"arxiv": "https://arxiv.org/abs/2503.01234"}
        }),
        "from_locations": normalizer({
            "primary_location": {"landing_page_url": "https://arxiv.org/abs/2503.05678v2"}
        }),
        "non_arxiv": normalizer({
            "primary_location": {"landing_page_url": "https://example.com/paper"}
        }),
    }

print(json.dumps(payload, ensure_ascii=False))
`);

		expect(output).toEqual({
			from_ids: 'https://arxiv.org/abs/2503.01234',
			from_locations: 'https://arxiv.org/abs/2503.05678',
			non_arxiv: null,
		});
	});

	test('prefers official arXiv results over OpenAlex duplicates', () => {
		const output = runPythonJson(`
import importlib.util, json
spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

merge = getattr(module, "deduplicate_papers", None)
if merge is None:
    payload = []
else:
    payload = merge([
        {
            "title": "LLM Agent Planning",
            "link": "https://arxiv.org/abs/2503.01234",
            "published": "2026-03-28",
            "summary": "Official arXiv summary",
            "categories": "cs.AI",
            "authors": "Ada, Linus",
            "source": "arxiv",
            "score": 8,
        },
        {
            "title": "LLM Agent Planning",
            "link": "https://arxiv.org/abs/2503.01234",
            "published": "2026-03-28",
            "summary": "OpenAlex summary",
            "categories": "cs.AI",
            "authors": "Ada, Linus",
            "source": "openalex",
            "score": 8,
        },
    ])

print(json.dumps(payload, ensure_ascii=False))
`);

		expect(output).toEqual([
			{
				title: 'LLM Agent Planning',
				link: 'https://arxiv.org/abs/2503.01234',
				published: '2026-03-28',
				summary: 'Official arXiv summary',
				categories: 'cs.AI',
				authors: 'Ada, Linus',
				source: 'arxiv',
			},
		]);
	});

	test('returns structured errors for non-English keywords and falls back to OpenAlex', () => {
		const output = runPythonJson(`
import importlib.util, json
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

collector = getattr(module, "collect_arxiv_papers", None)
if collector is None:
    payload = {"papers": None, "errors": None}
else:
    cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
    payload = collector(
        keywords=["智能体"],
        categories=["cs.AI"],
        max_results=50,
        cutoff=cutoff,
        language="en",
    )

print(json.dumps(payload, ensure_ascii=False))
`);

		expect(output).toEqual({
			papers: [],
			errors: [
				{
					module: 'arxiv',
					source: 'config',
					message: 'arXiv keywords must be English',
				},
			],
		});
	});

	test('falls back to OpenAlex when the primary arXiv fetch fails', () => {
		const output = runPythonJson(`
import importlib.util, json
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

collector = getattr(module, "collect_arxiv_papers", None)
if collector is None:
    payload = {"papers": None, "errors": None}
else:
    def fail_primary(*args, **kwargs):
        raise RuntimeError("HTTP 403")

    def openalex_results(*args, **kwargs):
        return {
            "results": [
                {
                    "title": "Reliable Tool Use for LLM Agents",
                    "publication_date": "2026-03-29",
                    "abstract_inverted_index": {
                        "Reliable": [0],
                        "tool": [1],
                        "use": [2],
                        "for": [3],
                        "LLM": [4],
                        "agents": [5],
                    },
                    "primary_location": {
                        "landing_page_url": "https://arxiv.org/abs/2503.12345v1"
                    },
                    "locations": [],
                    "authorships": [
                        {"author": {"display_name": "Ada"}},
                        {"author": {"display_name": "Linus"}},
                    ],
                    "primary_topic": {"subfield": {"display_name": "Artificial Intelligence"}},
                }
            ]
        }

    module.fetch_recent_arxiv_category = fail_primary
    module.fetch_openalex_works = openalex_results

    cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
    payload = collector(
        keywords=["llm agent", "tool use"],
        categories=["cs.AI"],
        max_results=50,
        cutoff=cutoff,
        language="en",
    )

print(json.dumps(payload, ensure_ascii=False))
`);

		expect(output).toEqual({
			papers: [
				{
					title: 'Reliable Tool Use for LLM Agents',
					link: 'https://arxiv.org/abs/2503.12345',
					published: '2026-03-29',
					summary: 'Reliable tool use for LLM agents',
					categories: 'Artificial Intelligence',
					authors: 'Ada, Linus',
					source: 'openalex',
				},
			],
			errors: [
				{
					module: 'arxiv',
					source: 'arxiv-api',
					message: 'HTTP 403',
				},
			],
		});
	});
});
