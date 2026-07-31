import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import {
	advanceVaultPathGuard,
	createVaultPathGuard,
	revalidateVaultPathGuard,
} from '../../../assets/skills/_shared/scripts/path_safety.mjs';

function stableRunId(skill, input) {
	const hash = createHash('sha256')
		.update(JSON.stringify({ skill, input }))
		.digest('hex')
		.slice(0, 12);
	return `${skill}-${hash}`;
}

function writeGuarded(root, targetPath, value) {
	const absolute = join(root, ...targetPath.split('/'));
	mkdirSync(dirname(absolute), { recursive: true });
	const guard = createVaultPathGuard(root, targetPath);
	revalidateVaultPathGuard(guard);
	writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
	if (guard.leaf.state === 'missing') {
		const advanced = advanceVaultPathGuard(guard, { before: 'missing', after: 'existing' });
		revalidateVaultPathGuard(advanced);
	} else {
		revalidateVaultPathGuard(guard);
	}
}

function writeManifest(root, skill, value) {
	writeGuarded(root, `.operation-manifests/${skill}.json`, value);
}

function executeArtifactTwice({
	root,
	skill,
	input,
	targetPath,
	secondDecision,
	status,
	artifact,
}) {
	const runId = stableRunId(skill, input);
	const manifest = {
		run_id: runId,
		target_path: targetPath,
		status,
		attempts: [],
		errors: [],
	};
	const runs = [];
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		const decision = existsSync(join(root, ...targetPath.split('/'))) ? secondDecision : 'create';
		const run = { attempt, run_id: runId, target_path: targetPath, decision, status };
		manifest.attempts.push({ attempt, decision, status });
		writeGuarded(root, targetPath, { ...artifact, run_id: runId, status });
		writeManifest(root, skill, manifest);
		runs.push({ ...run, manifest: structuredClone(manifest) });
	}
	return { input, runs, manifest };
}

function executeDigest(root) {
	const input = { config_hash: 'cfg-ai-v1', time_window: '2026-07-25--2026-07-31' };
	const sources = [
		{
			id: 'rss-main',
			published_at: '2026-07-30',
			fetched_at: '2026-07-31T08:00:00Z',
			health: 'healthy',
			errors: [],
		},
		{
			id: 'paper-backup',
			published_at: null,
			fetched_at: '2026-07-31T08:00:00Z',
			health: 'failed',
			errors: ['source_timeout'],
		},
	];
	const result = executeArtifactTwice({
		root,
		skill: 'digest',
		input,
		targetPath: '00_Drafts/AI-2026-07-25--2026-07-31.md',
		secondDecision: 'merge',
		status: 'partial',
		artifact: { sources },
	});
	result.manifest.sources = sources;
	for (const run of result.runs) run.manifest.sources = sources;
	writeManifest(root, 'digest', result.manifest);
	return result;
}

function executeArchive(root) {
	const input = { candidates: ['20_Projects/Demo.md'], archive_date: '2026-07-31' };
	const runId = stableRunId('archive', input);
	const source = '20_Projects/Demo.md';
	const target = '90_System/Archive/Projects/2026/Demo.md';
	mkdirSync(dirname(join(root, source)), { recursive: true });
	mkdirSync(dirname(join(root, target)), { recursive: true });
	writeFileSync(join(root, source), 'source', 'utf8');
	writeFileSync(join(root, target), 'existing-target', 'utf8');
	const manifest = {
		run_id: runId,
		moves: [],
		collisions: [{ source, target }],
		notified: [],
		errors: ['collision_preflight'],
		recovery: ['resolve_collision_then_resume_same_run_id'],
	};
	const runs = [];
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		writeManifest(root, 'archive', manifest);
		runs.push({
			attempt,
			run_id: runId,
			target_path: target,
			decision: 'skip',
			status: 'failed',
			manifest: structuredClone(manifest),
		});
	}
	return { input, runs, manifest };
}

function walk(root, current = root) {
	return readdirSync(current, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(current, entry.name);
			if (entry.isDirectory()) return walk(root, path);
			if (!entry.isFile() && !statSync(path).isFile()) return [];
			return [relative(root, path).split(sep).join('/')];
		})
		.sort();
}

export function runOperationScenarioSuite(root) {
	mkdirSync(root, { recursive: true });
	const scenarios = {
		today: executeArtifactTwice({
			root,
			skill: 'today',
			input: { date: '2026-07-31', selected_items: ['project-demo'] },
			targetPath: '10_Diary/2026-07-31.md',
			secondDecision: 'merge',
			status: 'active',
			artifact: { tasks: [{ task_id: 'project-demo-next', done: false }] },
		}),
		digest: executeDigest(root),
		research: executeArtifactTwice({
			root,
			skill: 'research',
			input: { topic: 'agent-memory', plan_revision: 1, confirmed_hash: 'plan-001' },
			targetPath: '30_Research/agent-memory.md',
			secondDecision: 'resume',
			status: 'draft',
			artifact: { artifacts: ['outline'] },
		}),
		translate: executeArtifactTwice({
			root,
			skill: 'translate',
			input: { source: 'book.pdf', chapter: '1', extraction_hash: 'extract-001' },
			targetPath: '70_Resources/Translations/Book/Chapter-1.md',
			secondDecision: 'resume',
			status: 'draft',
			artifact: { completed_pages: [1] },
		}),
		revise: executeArtifactTwice({
			root,
			skill: 'revise',
			input: { note_id: 'book-chapter-1', mode: 'quiz', note_hash: 'note-001' },
			targetPath: '40_Knowledge/Notes/Book/Chapter-1/revise.md',
			secondDecision: 'resume',
			status: 'pending',
			artifact: { questions: [{ knowledge_point_id: 'kp-1', source_refs: ['Chapter-1#p1'] }] },
		}),
		archive: executeArchive(root),
	};
	return {
		context: 'protocol-adapter-fixture',
		boundary: '验证技能操作协议，不执行真实客户端或网络抓取',
		fixture_root: root,
		scenarios,
		file_tree: walk(root),
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const root = mkdtempSync(join(tmpdir(), 'lifeos-operation-fixture-'));
	process.stdout.write(`${JSON.stringify(runOperationScenarioSuite(root), null, 2)}\n`);
}
