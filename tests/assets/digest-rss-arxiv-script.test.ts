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
				source_type: 'arXiv',
				scope: 'cs.AI',
			},
		]);
	});

	test('normalizes phase-1 paper source records into one schema', () => {
		const output = runPythonJson(`
import importlib.util, json
spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

normalizer = getattr(module, "normalize_paper_record", None)
if normalizer is None:
    payload = None
else:
    payload = {
        "arxiv": normalizer(
            "arXiv",
            {
                "title": "  LLM Agent Planning  ",
                "link": "https://arxiv.org/abs/2503.01234v2",
                "published": "2026-03-28",
                "summary": "  Official arXiv summary  ",
                "authors": ["Ada", "Linus"],
                "categories": "cs.AI",
            },
            "cs.AI",
            "en",
        ),
        "biorxiv": normalizer(
            "bioRxiv",
            {
                "title": "Single-cell atlas for immune state",
                "link": "https://doi.org/10.1101/2026.03.28.123456",
                "published": "2026-03-29",
                "summary": "Spatial transcriptomics with atlas-scale coverage",
                "authors": "Ada Lovelace; Grace Hopper",
                "categories": "neuroscience",
            },
            "neuroscience",
            "en",
        ),
        "medrxiv": normalizer(
            "medRxiv",
            {
                "title": "ICU monitoring for sepsis",
                "link": "https://doi.org/10.1101/2026.03.28.654321",
                "published": "2026-03-30",
                "summary": "Clinical monitoring update",
                "authors": ["Ada Lovelace", "Grace Hopper", "Linus Torvalds"],
                "categories": "critical care",
            },
            "critical care",
            "en",
        ),
        "chemrxiv": normalizer(
            "ChemRxiv",
            {
                "title": "Catalyst discovery with polymer electrolytes",
                "link": "https://doi.org/10.26434/chemrxiv-2026-abcdef",
                "published": "2026-03-31",
                "summary": "Chemistry preprint summary",
                "authors": "Ada Lovelace, Linus Torvalds",
                "categories": "catalysis",
            },
            "catalysis",
            "en",
        ),
    }

print(json.dumps(payload, ensure_ascii=False))
`);

		expect(output).toEqual({
			arxiv: {
				title: 'LLM Agent Planning',
				link: 'https://arxiv.org/abs/2503.01234',
				published: '2026-03-28',
				summary: 'Official arXiv summary',
				categories: 'cs.AI',
				authors: 'Ada, Linus',
				source: 'arxiv',
				source_type: 'arXiv',
				scope: 'cs.AI',
			},
			biorxiv: {
				title: 'Single-cell atlas for immune state',
				link: 'https://doi.org/10.1101/2026.03.28.123456',
				published: '2026-03-29',
				summary: 'Spatial transcriptomics with atlas-scale coverage',
				categories: 'neuroscience',
				authors: 'Ada Lovelace; Grace Hopper',
				source: 'biorxiv',
				source_type: 'bioRxiv',
				scope: 'neuroscience',
			},
			medrxiv: {
				title: 'ICU monitoring for sepsis',
				link: 'https://doi.org/10.1101/2026.03.28.654321',
				published: '2026-03-30',
				summary: 'Clinical monitoring update',
				categories: 'critical care',
				authors: 'Ada Lovelace, Grace Hopper, Linus Torvalds',
				source: 'medrxiv',
				source_type: 'medRxiv',
				scope: 'critical care',
			},
			chemrxiv: {
				title: 'Catalyst discovery with polymer electrolytes',
				link: 'https://doi.org/10.26434/chemrxiv-2026-abcdef',
				published: '2026-03-31',
				summary: 'Chemistry preprint summary',
				categories: 'catalysis',
				authors: 'Ada Lovelace, Linus Torvalds',
				source: 'chemrxiv',
				source_type: 'ChemRxiv',
				scope: 'catalysis',
			},
		});
	});

	test('uses lowercase official server keys for bioRxiv and medRxiv API calls', () => {
		const output = runPythonJson(`
import importlib.util, json
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

servers = []

def fake_fetch_biorxiv_pubs(server, cutoff):
    servers.append(server)
    return {
        "collection": [
            {
                "preprint_title": f"{server} result",
                "biorxiv_doi": "10.1101/2026.03.28.123456",
                "preprint_date": "2026-03-29",
                "preprint_abstract": "Atlas biomarker result for digest testing",
                "preprint_authors": "Ada Lovelace; Grace Hopper",
                "preprint_category": "neuroscience",
            }
        ]
    }

module.fetch_biorxiv_pubs = fake_fetch_biorxiv_pubs
cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
biorxiv_payload = module.collect_biorxiv_source(
    {"queries": ["atlas biomarker"], "scope": "neuroscience", "max_results": 20},
    cutoff,
    "en",
)
medrxiv_payload = module.collect_medrxiv_source(
    {"queries": ["atlas biomarker"], "scope": "neuroscience", "max_results": 20},
    cutoff,
    "en",
)

print(json.dumps({
    "servers": servers,
    "biorxiv_count": len(biorxiv_payload["papers"]),
    "medrxiv_count": len(medrxiv_payload["papers"]),
}, ensure_ascii=False))
`);

		expect(output).toEqual({
			servers: ['biorxiv', 'medrxiv'],
			biorxiv_count: 1,
			medrxiv_count: 1,
		});
	});

	test('uses the official bioRxiv details endpoint for recent preprints', () => {
		const output = runPythonJson(`
import importlib.util, json, urllib.parse
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

captured = {}

class FakeResponse:
    def read(self):
        return json.dumps({"collection": []}).encode("utf-8")
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False

def fake_urlopen(request, timeout=0):
    captured["url"] = request.full_url
    return FakeResponse()

module.urllib.request.urlopen = fake_urlopen
cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
module.fetch_biorxiv_pubs("biorxiv", cutoff)

parsed = urllib.parse.urlparse(captured["url"])
print(json.dumps({
    "path": parsed.path,
    "suffix": parsed.path.split("/details/")[-1],
}, ensure_ascii=False))
`);

		expect(output).toEqual({
			path: '/details/biorxiv/2026-03-20/2026-03-30/0/json',
			suffix: 'biorxiv/2026-03-20/2026-03-30/0/json',
		});
	});

	test('parses official details payload dates for bioRxiv and medRxiv results', () => {
		const output = runPythonJson(`
import importlib.util, json
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fake_fetch_biorxiv_pubs(server, cutoff):
    return {
        "collection": [
            {
                "title": f"{server} protein result",
                "doi": "10.1101/2026.03.28.123456",
                "date": "2026-03-29",
                "abstract": "protein biomarker atlas",
                "authors": "Ada Lovelace; Grace Hopper",
                "category": "bioinformatics",
            }
        ]
    }

module.fetch_biorxiv_pubs = fake_fetch_biorxiv_pubs
cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
biorxiv_payload = module.collect_biorxiv_source(
    {"queries": ["protein"], "scope": "", "max_results": 20},
    cutoff,
    "en",
)
medrxiv_payload = module.collect_medrxiv_source(
    {"queries": ["protein"], "scope": "", "max_results": 20},
    cutoff,
    "en",
)

print(json.dumps({
    "biorxiv": biorxiv_payload,
    "medrxiv": medrxiv_payload,
}, ensure_ascii=False))
`);

		expect(output).toEqual({
			biorxiv: {
				papers: [
					{
						title: 'biorxiv protein result',
						link: 'https://doi.org/10.1101/2026.03.28.123456',
						published: '2026-03-29',
						summary: 'protein biomarker atlas',
						categories: 'bioinformatics',
						authors: 'Ada Lovelace; Grace Hopper',
						source: 'biorxiv',
						source_type: 'bioRxiv',
						scope: 'bioinformatics',
					},
				],
				errors: [],
			},
			medrxiv: {
				papers: [
					{
						title: 'medrxiv protein result',
						link: 'https://doi.org/10.1101/2026.03.28.123456',
						published: '2026-03-29',
						summary: 'protein biomarker atlas',
						categories: 'bioinformatics',
						authors: 'Ada Lovelace; Grace Hopper',
						source: 'medrxiv',
						source_type: 'medRxiv',
						scope: 'bioinformatics',
					},
				],
				errors: [],
			},
		});
	});

	test('retries transient bioRxiv connection drops before failing', () => {
		const output = runPythonJson(`
import http.client, importlib.util, json
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

attempts = []

class FakeResponse:
    def read(self):
        return json.dumps({"collection": []}).encode("utf-8")
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False

def fake_urlopen(request, timeout=0):
    attempts.append(request.full_url)
    if len(attempts) == 1:
        raise http.client.RemoteDisconnected("Remote end closed connection without response")
    return FakeResponse()

module.urllib.request.urlopen = fake_urlopen
cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
payload = module.fetch_biorxiv_pubs("biorxiv", cutoff)

print(json.dumps({
    "attempt_count": len(attempts),
    "collection": payload["collection"],
}, ensure_ascii=False))
`);

		expect(output).toEqual({
			attempt_count: 2,
			collection: [],
		});
	});

	test('fetches ChemRxiv results through repository-filtered OpenAlex transport', () => {
		const output = runPythonJson(`
import importlib.util, io, json, urllib.parse
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

captured = {}

class FakeResponse:
    def __init__(self, payload):
        self.payload = payload
    def read(self):
        return self.payload.encode("utf-8")
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False

def fake_urlopen(request, timeout=0):
    captured["url"] = request.full_url
    return FakeResponse(json.dumps({"results": [{"id": "W1"}]}))

module.urllib.request.urlopen = fake_urlopen
cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
payload = module.fetch_chemrxiv_results(
    {"queries": ["catalyst discovery"], "max_results": 25},
    cutoff,
)
parsed = urllib.parse.urlparse(captured["url"])
params = urllib.parse.parse_qs(parsed.query)

print(json.dumps({
    "host": parsed.netloc,
    "path": parsed.path,
    "search": params.get("search", []),
    "filter": params.get("filter", []),
    "per_page": params.get("per-page", []),
    "result_count": len(payload.get("results", [])),
}, ensure_ascii=False))
`);

		expect(output).toEqual({
			host: 'api.openalex.org',
			path: '/works',
			search: ['catalyst discovery'],
			filter: ['from_publication_date:2026-03-20,repository:S4393918830'],
			per_page: ['25'],
			result_count: 1,
		});
	});

	test('collects ChemRxiv papers from repository-filtered OpenAlex payloads', () => {
		const output = runPythonJson(`
import importlib.util, json
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fake_fetch_chemrxiv_results(source, cutoff):
    return {
        "results": [
            {
                "display_name": "Catalyst discovery with polymer electrolytes",
                "publication_date": "2026-03-30",
                "abstract_inverted_index": {
                    "Catalyst": [0],
                    "discovery": [1],
                    "with": [2],
                    "polymer": [3],
                    "electrolytes": [4],
                },
                "doi": "https://doi.org/10.26434/chemrxiv-2026-abcdef",
                "authorships": [
                    {"author": {"display_name": "Ada Lovelace"}},
                    {"author": {"display_name": "Linus Torvalds"}},
                ],
                "primary_topic": {
                    "subfield": {"display_name": "Catalysis"}
                },
                "primary_location": {
                    "source": {"display_name": "ChemRxiv"},
                    "landing_page_url": "https://doi.org/10.26434/chemrxiv-2026-abcdef",
                    "pdf_url": "https://chemrxiv.org/doi/pdf/10.26434/chemrxiv-2026-abcdef",
                },
                "locations": [
                    {
                        "source": {"display_name": "ChemRxiv"},
                        "landing_page_url": "https://doi.org/10.26434/chemrxiv-2026-abcdef",
                        "pdf_url": "https://chemrxiv.org/doi/pdf/10.26434/chemrxiv-2026-abcdef",
                    }
                ],
            }
        ]
    }

module.fetch_chemrxiv_results = fake_fetch_chemrxiv_results
cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
payload = module.collect_chemrxiv_source(
    {"queries": ["catalyst discovery"], "scope": "catalysis", "max_results": 20},
    cutoff,
    "en",
)

print(json.dumps(payload, ensure_ascii=False))
`);

		expect(output).toEqual({
			papers: [
				{
					title: 'Catalyst discovery with polymer electrolytes',
					link: 'https://doi.org/10.26434/chemrxiv-2026-abcdef',
					published: '2026-03-30',
					summary: 'Catalyst discovery with polymer electrolytes',
					categories: 'Catalysis',
					authors: 'Ada Lovelace, Linus Torvalds',
					source: 'chemrxiv',
					source_type: 'ChemRxiv',
					scope: 'catalysis',
				},
			],
			errors: [],
		});
	});

	test('fetches SocArXiv results through repository-filtered OpenAlex transport', () => {
		const output = runPythonJson(`
import importlib.util, json, urllib.parse
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

captured = {}

class FakeResponse:
    def __init__(self, payload):
        self.payload = payload
    def read(self):
        return self.payload.encode("utf-8")
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False

def fake_urlopen(request, timeout=0):
    captured["url"] = request.full_url
    return FakeResponse(json.dumps({"results": [{"id": "W1"}]}))

module.urllib.request.urlopen = fake_urlopen
cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
payload = module.fetch_socarxiv_results(
    {"queries": ["social identity"], "max_results": 25},
    cutoff,
)
parsed = urllib.parse.urlparse(captured["url"])
params = urllib.parse.parse_qs(parsed.query)

print(json.dumps({
    "host": parsed.netloc,
    "path": parsed.path,
    "search": params.get("search", []),
    "filter": params.get("filter", []),
    "per_page": params.get("per-page", []),
    "result_count": len(payload.get("results", [])),
}, ensure_ascii=False))
`);

		expect(output).toEqual({
			host: 'api.openalex.org',
			path: '/works',
			search: ['social identity'],
			filter: ['from_publication_date:2026-03-20,repository:S4306401238'],
			per_page: ['25'],
			result_count: 1,
		});
	});

	test('collects SocArXiv papers from source-hosted OpenAlex payloads', () => {
		const output = runPythonJson(`
import importlib.util, json
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fake_fetch_socarxiv_results(source, cutoff):
    return {
        "results": [
            {
                "display_name": "The Partisan Effects of Social Media Bans",
                "publication_date": "2026-03-21",
                "abstract_inverted_index": {
                    "Social": [0],
                    "identity": [1],
                    "effects": [2],
                },
                "authorships": [
                    {"author": {"display_name": "Ada Lovelace"}},
                    {"author": {"display_name": "Grace Hopper"}},
                ],
                "primary_topic": {
                    "subfield": {"display_name": "Sociology"}
                },
                "primary_location": {
                    "source": {"display_name": "SocArXiv (OSF Preprints)"},
                    "landing_page_url": "https://osf.io/4stfw",
                },
                "locations": [
                    {
                        "source": {"display_name": "SocArXiv (OSF Preprints)"},
                        "landing_page_url": "https://osf.io/4stfw",
                    },
                    {
                        "source": {"display_name": "Example"},
                        "landing_page_url": "https://example.com/not-socarxiv",
                    }
                ],
            },
            {
                "display_name": "Rejected mirror result",
                "publication_date": "2026-03-21",
                "abstract_inverted_index": {
                    "Social": [0],
                    "identity": [1],
                },
                "primary_topic": {
                    "subfield": {"display_name": "Sociology"}
                },
                "primary_location": {
                    "source": {"display_name": "Example"},
                    "landing_page_url": "https://example.com/not-socarxiv",
                },
                "locations": [
                    {
                        "source": {"display_name": "Example"},
                        "landing_page_url": "https://example.com/not-socarxiv",
                    }
                ],
            }
        ]
    }

module.fetch_socarxiv_results = fake_fetch_socarxiv_results
cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
payload = module.collect_socarxiv_source(
    {"queries": ["social identity"], "scope": "sociology", "max_results": 20},
    cutoff,
    "en",
)

print(json.dumps(payload, ensure_ascii=False))
`);

		expect(output).toEqual({
			papers: [
				{
					title: 'The Partisan Effects of Social Media Bans',
					link: 'https://osf.io/4stfw',
					published: '2026-03-21',
					summary: 'Social identity effects',
					categories: 'Sociology',
					authors: 'Ada Lovelace, Grace Hopper',
					source: 'socarxiv',
					source_type: 'SocArXiv',
					scope: 'sociology',
				},
			],
			errors: [],
		});
	});

	test('fetches SSRN results through repository-filtered OpenAlex transport', () => {
		const output = runPythonJson(`
import importlib.util, json, urllib.parse
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

captured = {}

class FakeResponse:
    def __init__(self, payload):
        self.payload = payload
    def read(self):
        return self.payload.encode("utf-8")
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False

def fake_urlopen(request, timeout=0):
    captured["url"] = request.full_url
    return FakeResponse(json.dumps({"results": [{"id": "W1"}]}))

module.urllib.request.urlopen = fake_urlopen
cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
payload = module.fetch_ssrn_results(
    {"queries": ["corporate governance"], "max_results": 25},
    cutoff,
)
parsed = urllib.parse.urlparse(captured["url"])
params = urllib.parse.parse_qs(parsed.query)

print(json.dumps({
    "host": parsed.netloc,
    "path": parsed.path,
    "search": params.get("search", []),
    "filter": params.get("filter", []),
    "per_page": params.get("per-page", []),
    "result_count": len(payload.get("results", [])),
}, ensure_ascii=False))
`);

		expect(output).toEqual({
			host: 'api.openalex.org',
			path: '/works',
			search: ['corporate governance'],
			filter: ['from_publication_date:2026-03-20,repository:S4210172589'],
			per_page: ['25'],
			result_count: 1,
		});
	});

	test('collects SSRN papers and prefers source-hosted landing pages', () => {
		const output = runPythonJson(`
import importlib.util, json
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fake_fetch_ssrn_results(source, cutoff):
    return {
        "results": [
            {
                "display_name": "Knowledge Is Power",
                "publication_date": "2026-02-06",
                "doi": "https://doi.org/10.2139/ssrn.3661649",
                "abstract_inverted_index": {
                    "Corporate": [0],
                    "governance": [1],
                    "monitoring": [2],
                },
                "authorships": [
                    {"author": {"display_name": "Ada Lovelace"}},
                    {"author": {"display_name": "Linus Torvalds"}},
                ],
                "primary_topic": {
                    "subfield": {"display_name": "Corporate Governance"}
                },
                "primary_location": {
                    "source": {"display_name": "SSRN Electronic Journal"},
                    "landing_page_url": "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3661649",
                },
                "locations": [
                    {
                        "source": {"display_name": "SSRN Electronic Journal"},
                        "landing_page_url": "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3661649",
                    },
                    {
                        "source": {"display_name": "Publisher"},
                        "landing_page_url": "https://doi.org/10.1111/1911-3846.70032",
                    }
                ],
            }
        ]
    }

module.fetch_ssrn_results = fake_fetch_ssrn_results
cutoff = datetime(2026, 1, 20, tzinfo=timezone.utc)
payload = module.collect_ssrn_source(
    {"queries": ["corporate governance"], "scope": "corporate governance", "max_results": 20},
    cutoff,
    "en",
)

print(json.dumps(payload, ensure_ascii=False))
`);

		expect(output).toEqual({
			papers: [
				{
					title: 'Knowledge Is Power',
					link: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3661649',
					published: '2026-02-06',
					summary: 'Corporate governance monitoring',
					categories: 'Corporate Governance',
					authors: 'Ada Lovelace, Linus Torvalds',
					source: 'ssrn',
					source_type: 'SSRN',
					scope: 'corporate governance',
				},
			],
			errors: [],
		});
	});

	test('aggregates multiple paper sources and keeps successful results after one failure', () => {
		const output = runPythonJson(`
import importlib.util, json
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def paper(title, source, source_type, scope):
    return {
        "title": title,
        "link": f"https://example.com/{source}/{title.replace(' ', '-').lower()}",
        "published": "2026-03-30",
        "summary": f"{title} summary",
        "categories": scope,
        "authors": "Ada Lovelace",
        "source": source,
        "source_type": source_type,
        "scope": scope,
    }

def collect_arxiv_source(*args, **kwargs):
    return {"papers": [paper("Shared Methods", "arxiv", "arXiv", "cs.AI")], "errors": []}

def collect_biorxiv_source(*args, **kwargs):
    return {"papers": [paper("Single-cell Atlas", "biorxiv", "bioRxiv", "neuroscience")], "errors": []}

def collect_medrxiv_source(*args, **kwargs):
    raise RuntimeError("HTTP 503")

def collect_chemrxiv_source(*args, **kwargs):
    return {"papers": [paper("Catalyst Discovery", "chemrxiv", "ChemRxiv", "catalysis")], "errors": []}

def collect_socarxiv_source(*args, **kwargs):
    return {"papers": [paper("The Partisan Effects", "socarxiv", "SocArXiv", "sociology")], "errors": []}

def collect_ssrn_source(*args, **kwargs):
    return {"papers": [paper("Knowledge Is Power", "ssrn", "SSRN", "corporate governance")], "errors": []}

module.collect_arxiv_source = collect_arxiv_source
module.collect_biorxiv_source = collect_biorxiv_source
module.collect_medrxiv_source = collect_medrxiv_source
module.collect_chemrxiv_source = collect_chemrxiv_source
module.collect_socarxiv_source = collect_socarxiv_source
module.collect_ssrn_source = collect_ssrn_source

cutoff = datetime(2026, 3, 20, tzinfo=timezone.utc)
payload = module.collect_papers(
    [
        {"enabled": True, "source_type": "arXiv", "queries": ['"llm agent"'], "scope": "cs.AI", "notes": "English only"},
        {"enabled": True, "source_type": "bioRxiv", "queries": ["single-cell atlas"], "scope": "neuroscience", "notes": "English only"},
        {"enabled": True, "source_type": "medRxiv", "queries": ["sepsis biomarker"], "scope": "critical care", "notes": "English only"},
        {"enabled": True, "source_type": "ChemRxiv", "queries": ["catalyst discovery"], "scope": "catalysis", "notes": "English only"},
        {"enabled": True, "source_type": "SocArXiv", "queries": ["social identity"], "scope": "sociology", "notes": "English only"},
        {"enabled": True, "source_type": "SSRN", "queries": ["corporate governance"], "scope": "corporate governance", "notes": "English only"},
    ],
    cutoff,
    "en",
    100,
)

print(json.dumps(payload, ensure_ascii=False))
`);

		expect(output).toEqual({
			papers: [
				{
					title: 'Shared Methods',
					link: 'https://example.com/arxiv/shared-methods',
					published: '2026-03-30',
					summary: 'Shared Methods summary',
					categories: 'cs.AI',
					authors: 'Ada Lovelace',
					source: 'arxiv',
					source_type: 'arXiv',
					scope: 'cs.AI',
				},
				{
					title: 'The Partisan Effects',
					link: 'https://example.com/socarxiv/the-partisan-effects',
					published: '2026-03-30',
					summary: 'The Partisan Effects summary',
					categories: 'sociology',
					authors: 'Ada Lovelace',
					source: 'socarxiv',
					source_type: 'SocArXiv',
					scope: 'sociology',
				},
				{
					title: 'Single-cell Atlas',
					link: 'https://example.com/biorxiv/single-cell-atlas',
					published: '2026-03-30',
					summary: 'Single-cell Atlas summary',
					categories: 'neuroscience',
					authors: 'Ada Lovelace',
					source: 'biorxiv',
					source_type: 'bioRxiv',
					scope: 'neuroscience',
				},
				{
					title: 'Knowledge Is Power',
					link: 'https://example.com/ssrn/knowledge-is-power',
					published: '2026-03-30',
					summary: 'Knowledge Is Power summary',
					categories: 'corporate governance',
					authors: 'Ada Lovelace',
					source: 'ssrn',
					source_type: 'SSRN',
					scope: 'corporate governance',
				},
				{
					title: 'Catalyst Discovery',
					link: 'https://example.com/chemrxiv/catalyst-discovery',
					published: '2026-03-30',
					summary: 'Catalyst Discovery summary',
					categories: 'catalysis',
					authors: 'Ada Lovelace',
					source: 'chemrxiv',
					source_type: 'ChemRxiv',
					scope: 'catalysis',
				},
			],
			errors: [
				{
					module: 'medrxiv',
					source: 'adapter',
					message: 'HTTP 503',
				},
			],
		});
	});

	test('keeps the legacy top-level envelope while aggregating new paper sources', () => {
		const output = runPythonJson(`
import importlib.util, io, json, sys
spec = importlib.util.spec_from_file_location("digest_script", r"""${SCRIPT_PATH}""")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def fake_collect_papers(*args, **kwargs):
    return {
        "papers": [
            {
                "title": "Shared Methods",
                "link": "https://example.com/arxiv/shared-methods",
                "published": "2026-03-30",
                "summary": "Shared Methods summary",
                "categories": "cs.AI",
                "authors": "Ada Lovelace",
                "source": "arxiv",
                "source_type": "arXiv",
                "scope": "cs.AI",
            },
            {
                "title": "Single-cell Atlas",
                "link": "https://example.com/biorxiv/single-cell-atlas",
                "published": "2026-03-30",
                "summary": "Single-cell Atlas summary",
                "categories": "neuroscience",
                "authors": "Ada Lovelace",
                "source": "biorxiv",
                "source_type": "bioRxiv",
                "scope": "neuroscience",
            },
        ],
        "errors": [
            {"module": "medrxiv", "source": "adapter", "message": "HTTP 503"},
        ],
    }

module.collect_papers = fake_collect_papers
module.ensure_dependencies = lambda: None

stdin = io.StringIO(json.dumps({
    "language": "en",
    "rss": {"enabled": False},
    "paper_sources": [
        {"enabled": True, "source_type": "arXiv", "queries": ['"llm agent"'], "scope": "cs.AI", "notes": "English only"},
        {"enabled": True, "source_type": "bioRxiv", "queries": ["single-cell atlas"], "scope": "neuroscience", "notes": "English only"},
    ],
    "days": 7,
}))
stdout = io.StringIO()
previous_stdin = sys.stdin
previous_stdout = sys.stdout
sys.stdin = stdin
sys.stdout = stdout
try:
    module.main()
finally:
    sys.stdin = previous_stdin
    sys.stdout = previous_stdout

print(stdout.getvalue().strip())
`);

		expect(output).toEqual({
			rss_articles: [],
			arxiv_papers: [
				{
					title: 'Shared Methods',
					link: 'https://example.com/arxiv/shared-methods',
					published: '2026-03-30',
					summary: 'Shared Methods summary',
					categories: 'cs.AI',
					authors: 'Ada Lovelace',
					source: 'arxiv',
					source_type: 'arXiv',
					scope: 'cs.AI',
				},
				{
					title: 'Single-cell Atlas',
					link: 'https://example.com/biorxiv/single-cell-atlas',
					published: '2026-03-30',
					summary: 'Single-cell Atlas summary',
					categories: 'neuroscience',
					authors: 'Ada Lovelace',
					source: 'biorxiv',
					source_type: 'bioRxiv',
					scope: 'neuroscience',
				},
			],
			stats: {
				rss_count: 0,
				arxiv_count: 2,
			},
			errors: [
				{
					module: 'medrxiv',
					source: 'adapter',
					message: 'HTTP 503',
				},
			],
		});
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
					source_type: 'openalex',
					scope: 'Artificial Intelligence',
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
