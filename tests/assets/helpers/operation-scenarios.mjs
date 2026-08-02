import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
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

function createTrustedManifestStore() {
	const secret = randomBytes(32);
	const stored = new Set();
	const digest = (vaultIdentity, manifest) =>
		createHmac('sha256', secret)
			.update(JSON.stringify({ vault_identity: vaultIdentity, manifest }))
			.digest('hex');
	return {
		async persist_manifest({ manifest, vault_identity }) {
			const receipt = `hmac-sha256:${digest(vault_identity, manifest)}`;
			stored.add(`${receipt}\n${JSON.stringify({ vault_identity, manifest })}`);
			return { ok: true, receipt };
		},
		async verify_manifest_receipt({ manifest, persistence_receipt, vault_identity }) {
			return {
				ok: true,
				verified:
					persistence_receipt === `hmac-sha256:${digest(vault_identity, manifest)}` &&
					stored.has(`${persistence_receipt}\n${JSON.stringify({ vault_identity, manifest })}`),
			};
		},
	};
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

export async function runOperationScenarioSuite(root) {
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
	};
	return {
		context: 'protocol-adapter-fixture',
		boundary: '验证真实临时文件系统归档事务；外部客户端、MCP 与网络能力使用记录型适配器',
		fixture_root: root,
		scenarios,
		file_tree: walk(root),
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const root = mkdtempSync(join(tmpdir(), 'lifeos-operation-fixture-'));
	process.stdout.write(`${JSON.stringify(await runOperationScenarioSuite(root), null, 2)}\n`);
}
