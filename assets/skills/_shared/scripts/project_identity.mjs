import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const reserved = new Set(['placeholder', 'project-template']);
const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(value) {
	return String(value ?? '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function filenameStem(filename) {
	return String(filename ?? '').replace(/\.[^/.]+$/, '');
}

export function validateProjectIdentity(value) {
	if (typeof value !== 'string' || !pattern.test(value)) {
		return { valid: false, reason: '项目 ID 必须是 ASCII 小写 kebab-case 字符串' };
	}
	if (reserved.has(value) || value.includes('placeholder')) {
		return { valid: false, reason: '项目 ID 不能使用保留占位值' };
	}
	return { valid: true };
}

export function generateProjectIdentity({ title, filename, existing_ids }) {
	if (!Array.isArray(existing_ids)) throw new Error('existing_ids 必须是数组');
	const base = [slugify(title), slugify(filenameStem(filename))].find(
		(candidate) => validateProjectIdentity(candidate).valid,
	);
	if (!base) throw new Error('标题和文件名均不能生成有效项目 ID');
	const existing = new Set(existing_ids.map((id) => String(id)));
	let suffix = 1;
	let project_id = base;
	while (existing.has(project_id)) {
		suffix += 1;
		project_id = `${base}-${suffix}`;
	}
	return { project_id, base, suffix };
}

function main() {
	try {
		const input = JSON.parse(readFileSync(0, 'utf-8'));
		process.stdout.write(`${JSON.stringify(generateProjectIdentity(input))}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
