import {
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

const TAR_BLOCK_SIZE = 512;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

interface ParsedEntry {
	data?: Buffer;
	kind: 'directory' | 'file';
	path: string;
	portableKey: string;
	segments: string[];
}

function isZeroBlock(block: Buffer): boolean {
	return block.every((byte) => byte === 0);
}

function decodeUtf8(value: Buffer, field: string): string {
	const decoded = value.toString('utf8');
	if (!Buffer.from(decoded, 'utf8').equals(value)) {
		throw new Error(`tar ${field} 不是有效 UTF-8`);
	}
	return decoded;
}

function readTextField(block: Buffer, offset: number, length: number, field: string): string {
	const value = block.subarray(offset, offset + length);
	const terminator = value.indexOf(0);
	if (terminator < 0) {
		return decodeUtf8(value, field);
	}
	if (value.subarray(terminator + 1).some((byte) => byte !== 0)) {
		throw new Error(`tar ${field} 在终止符后包含数据`);
	}
	return decodeUtf8(value.subarray(0, terminator), field);
}

function readOctalField(block: Buffer, offset: number, length: number, field: string): number {
	const value = block.subarray(offset, offset + length);
	if ((value[0] & 0x80) !== 0) {
		throw new Error(`tar ${field} 不支持 base-256 编码`);
	}
	const terminator = value.indexOf(0);
	const encoded = value
		.subarray(0, terminator < 0 ? value.length : terminator)
		.toString('ascii')
		.trim();
	if (encoded === '') {
		return 0;
	}
	if (!/^[0-7]+$/.test(encoded)) {
		throw new Error(`tar ${field} 不是合法八进制数`);
	}
	const parsed = Number.parseInt(encoded, 8);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`tar ${field} 超出安全整数范围`);
	}
	return parsed;
}

function validateChecksum(block: Buffer): void {
	const expected = readOctalField(block, 148, 8, 'checksum');
	let actual = 0;
	for (let index = 0; index < TAR_BLOCK_SIZE; index += 1) {
		actual += index >= 148 && index < 156 ? 0x20 : block[index];
	}
	if (actual !== expected) {
		throw new Error('tar header checksum 不匹配');
	}
}

function parsePaxPath(data: Buffer): string {
	let cursor = 0;
	let path: string | undefined;
	while (cursor < data.length) {
		const separator = data.indexOf(0x20, cursor);
		if (separator < 0) {
			throw new Error('PAX 记录缺少长度分隔符');
		}
		const encodedLength = data.subarray(cursor, separator).toString('ascii');
		if (!/^[1-9][0-9]*$/.test(encodedLength)) {
			throw new Error('PAX 记录长度无效');
		}
		const length = Number.parseInt(encodedLength, 10);
		const end = cursor + length;
		if (!Number.isSafeInteger(length) || end > data.length || end <= separator + 2) {
			throw new Error('PAX 记录被截断');
		}
		const record = data.subarray(separator + 1, end);
		if (record.at(-1) !== 0x0a) {
			throw new Error('PAX 记录缺少换行终止符');
		}
		const body = record.subarray(0, -1);
		const equals = body.indexOf(0x3d);
		if (equals < 1) {
			throw new Error('PAX 记录缺少键值分隔符');
		}
		const key = decodeUtf8(body.subarray(0, equals), 'PAX key');
		const value = decodeUtf8(body.subarray(equals + 1), `PAX ${key}`);
		if (key !== 'path') {
			throw new Error(`不支持的 PAX 字段：${key}`);
		}
		if (path !== undefined) {
			throw new Error('PAX path 重复');
		}
		path = value;
		cursor = end;
	}
	if (path === undefined) {
		throw new Error('PAX header 缺少 path');
	}
	return path;
}

function parseGnuLongPath(data: Buffer): string {
	let end = data.indexOf(0);
	if (end < 0) {
		end = data.at(-1) === 0x0a ? data.length - 1 : data.length;
	} else if (data.subarray(end + 1).some((byte) => byte !== 0)) {
		throw new Error('GNU 长路径终止符后包含数据');
	}
	return decodeUtf8(data.subarray(0, end), 'GNU long path');
}

function sanitizePath(
	rawPath: string,
	kind: ParsedEntry['kind'],
): Pick<ParsedEntry, 'path' | 'portableKey' | 'segments'> {
	if (rawPath === '' || rawPath.startsWith('/') || rawPath.startsWith('\\')) {
		throw new Error(`不安全的 tar 路径：${rawPath}`);
	}
	if (/^[A-Za-z]:/.test(rawPath) || rawPath.includes('\\')) {
		throw new Error(`不可移植的 tar 路径：${rawPath}`);
	}
	if (
		[...rawPath].some(
			(character) => (character.codePointAt(0) ?? 0) <= 0x1f || character === '\u007f',
		)
	) {
		throw new Error('tar 路径包含控制字符');
	}
	const path = kind === 'directory' && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
	if (path === '' || (kind === 'file' && path.endsWith('/'))) {
		throw new Error(`无效的 tar 路径：${rawPath}`);
	}
	const segments = path.split('/');
	for (const segment of segments) {
		if (segment === '' || segment === '.' || segment === '..') {
			throw new Error(`不安全的 tar 路径：${rawPath}`);
		}
		if (/[<>:"|?*]/u.test(segment) || /[. ]$/u.test(segment)) {
			throw new Error(`不可移植的 tar 路径：${rawPath}`);
		}
		const basename = segment.split('.')[0].toUpperCase();
		if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(basename)) {
			throw new Error(`tar 路径使用 Windows 保留名称：${rawPath}`);
		}
	}
	const portableKey = segments.map((segment) => segment.normalize('NFC').toLowerCase()).join('/');
	return { path, portableKey, segments };
}

function parseTar(tar: Buffer): ParsedEntry[] {
	if (tar.length < TAR_BLOCK_SIZE * 2 || tar.length % TAR_BLOCK_SIZE !== 0) {
		throw new Error('tar 长度无效或已截断');
	}
	const entries: ParsedEntry[] = [];
	const targets = new Set<string>();
	let pendingPaxPath: string | undefined;
	let pendingGnuPath: string | undefined;
	let offset = 0;
	let foundEnd = false;

	while (offset < tar.length) {
		const header = tar.subarray(offset, offset + TAR_BLOCK_SIZE);
		if (isZeroBlock(header)) {
			const secondEnd = tar.subarray(offset + TAR_BLOCK_SIZE, offset + TAR_BLOCK_SIZE * 2);
			if (secondEnd.length !== TAR_BLOCK_SIZE || !isZeroBlock(secondEnd)) {
				throw new Error('tar 缺少第二个结束块');
			}
			if (tar.subarray(offset + TAR_BLOCK_SIZE * 2).some((byte) => byte !== 0)) {
				throw new Error('tar 结束块后包含数据');
			}
			foundEnd = true;
			break;
		}

		validateChecksum(header);
		readOctalField(header, 100, 8, 'mode');
		readOctalField(header, 108, 8, 'uid');
		readOctalField(header, 116, 8, 'gid');
		const size = readOctalField(header, 124, 12, 'size');
		readOctalField(header, 136, 12, 'mtime');
		if (size > MAX_UNCOMPRESSED_BYTES) {
			throw new Error('tar entry 超过大小上限');
		}
		const magic = readTextField(header, 257, 6, 'magic');
		if (magic !== 'ustar') {
			throw new Error('仅支持 USTAR 归档');
		}
		if (readTextField(header, 263, 2, 'version') !== '00') {
			throw new Error('USTAR version 无效');
		}
		const name = readTextField(header, 0, 100, 'name');
		const prefix = readTextField(header, 345, 155, 'prefix');
		const headerPath = prefix === '' ? name : `${prefix}/${name}`;
		const typeByte = header[156];
		const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte);
		const dataStart = offset + TAR_BLOCK_SIZE;
		const dataEnd = dataStart + size;
		const nextOffset = dataStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
		if (dataEnd > tar.length || nextOffset > tar.length) {
			throw new Error('tar entry 数据被截断');
		}
		if (tar.subarray(dataEnd, nextOffset).some((byte) => byte !== 0)) {
			throw new Error('tar entry padding 非零');
		}
		const data = tar.subarray(dataStart, dataEnd);
		offset = nextOffset;

		if (type === 'x' || type === 'L') {
			if (pendingPaxPath !== undefined || pendingGnuPath !== undefined) {
				throw new Error('tar 长路径元数据不能嵌套');
			}
			if (type === 'x') {
				pendingPaxPath = parsePaxPath(data);
			} else {
				pendingGnuPath = parseGnuLongPath(data);
			}
			continue;
		}
		if (type === '1' || type === '2') {
			throw new Error('tar 中不允许硬链接或符号链接');
		}
		if (type !== '0' && type !== '5') {
			throw new Error(`不支持的 tar entry 类型：${type}`);
		}

		const rawPath = pendingPaxPath ?? pendingGnuPath ?? headerPath;
		pendingPaxPath = undefined;
		pendingGnuPath = undefined;
		const kind: ParsedEntry['kind'] = type === '5' ? 'directory' : 'file';
		if (kind === 'directory' && size !== 0) {
			throw new Error('tar 目录 entry 不得包含数据');
		}
		const safePath = sanitizePath(rawPath, kind);
		if (targets.has(safePath.portableKey)) {
			throw new Error(`tar 目标重复或发生跨平台碰撞：${safePath.path}`);
		}
		targets.add(safePath.portableKey);
		entries.push({
			...safePath,
			kind,
			...(kind === 'file' ? { data } : {}),
		});
		if (entries.length > MAX_ENTRIES) {
			throw new Error('tar entry 数量超过上限');
		}
	}

	if (!foundEnd) {
		throw new Error('tar 缺少结束块');
	}
	if (pendingPaxPath !== undefined || pendingGnuPath !== undefined) {
		throw new Error('tar 长路径元数据缺少后续 entry');
	}
	const entryKinds = new Map(entries.map((entry) => [entry.portableKey, entry.kind]));
	for (const entry of entries) {
		for (let depth = 1; depth < entry.segments.length; depth += 1) {
			const parentKey = entry.segments
				.slice(0, depth)
				.map((segment) => segment.normalize('NFC').toLowerCase())
				.join('/');
			if (entryKinds.get(parentKey) === 'file') {
				throw new Error(`tar 文件被用作父目录：${entry.path}`);
			}
		}
	}
	return entries;
}

function targetPath(root: string, entry: ParsedEntry): string {
	const target = resolve(root, ...entry.segments);
	if (target === root || !target.startsWith(`${root}${sep}`)) {
		throw new Error(`tar 目标逃逸解包目录：${entry.path}`);
	}
	return target;
}

export function extractTarGz(archivePath: string, destination: string): void {
	const tar = gunzipSync(readFileSync(archivePath), {
		maxOutputLength: MAX_UNCOMPRESSED_BYTES,
	});
	const entries = parseTar(tar);
	mkdirSync(destination, { recursive: true });
	const destinationStat = lstatSync(destination);
	if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
		throw new Error('tar 解包目标必须是普通目录');
	}
	if (readdirSync(destination).length > 0) {
		throw new Error('tar 解包目标必须为空目录');
	}
	const root = realpathSync(destination);
	for (const entry of entries
		.filter((candidate) => candidate.kind === 'directory')
		.sort((first, second) => first.segments.length - second.segments.length)) {
		mkdirSync(targetPath(root, entry), { recursive: true });
	}
	for (const entry of entries.filter((candidate) => candidate.kind === 'file')) {
		const target = targetPath(root, entry);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, entry.data ?? Buffer.alloc(0), { flag: 'wx' });
	}
}
