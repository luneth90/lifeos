import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { extractTarGz } from './tar.js';

interface TarEntry {
	data?: Buffer | string;
	linkName?: string;
	name: string;
	type?: string;
}

function writeOctal(block: Buffer, offset: number, length: number, value: number): void {
	const encoded = value.toString(8).padStart(length - 1, '0');
	if (encoded.length >= length) {
		throw new Error('测试 tar 数值超出字段长度');
	}
	block.write(encoded, offset, 'ascii');
	block[offset + length - 1] = 0;
}

function createHeader(entry: TarEntry, size: number): Buffer {
	const header = Buffer.alloc(512);
	if (Buffer.byteLength(entry.name) > 100) {
		throw new Error('测试 tar 名称必须通过 PAX 或 GNU 长路径承载');
	}
	header.write(entry.name, 0, 100, 'utf8');
	writeOctal(header, 100, 8, entry.type === '5' ? 0o755 : 0o644);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, size);
	writeOctal(header, 136, 12, 0);
	header.fill(0x20, 148, 156);
	header.write(entry.type ?? '0', 156, 1, 'ascii');
	if (entry.linkName) {
		header.write(entry.linkName, 157, 100, 'utf8');
	}
	header.write('ustar\0', 257, 6, 'ascii');
	header.write('00', 263, 2, 'ascii');
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
	header[154] = 0;
	header[155] = 0x20;
	return header;
}

function createTar(entries: TarEntry[]): Buffer {
	const chunks: Buffer[] = [];
	for (const entry of entries) {
		const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8');
		chunks.push(createHeader(entry, data.length), data);
		const padding = (512 - (data.length % 512)) % 512;
		if (padding > 0) {
			chunks.push(Buffer.alloc(padding));
		}
	}
	chunks.push(Buffer.alloc(1024));
	return Buffer.concat(chunks);
}

function paxRecord(key: string, value: string): string {
	const body = ` ${key}=${value}\n`;
	let length = Buffer.byteLength(body) + 1;
	while (Buffer.byteLength(String(length)) + Buffer.byteLength(body) !== length) {
		length = Buffer.byteLength(String(length)) + Buffer.byteLength(body);
	}
	return `${length}${body}`;
}

describe('纯 Node tar.gz 测试解包器', () => {
	let workspace: string;

	beforeEach(() => {
		workspace = mkdtempSync(join(tmpdir(), 'lifeos-tar-'));
	});

	afterEach(() => {
		rmSync(workspace, { recursive: true, force: true });
	});

	function writeArchive(tar: Buffer): string {
		const archive = join(workspace, 'package.tgz');
		writeFileSync(archive, gzipSync(tar));
		return archive;
	}

	test('解压 USTAR 目录与嵌套普通文件', () => {
		const archive = writeArchive(
			createTar([
				{ name: 'package/', type: '5' },
				{ name: 'package/dist/', type: '5' },
				{ name: 'package/dist/index.js', data: 'export const ok = true;\n' },
			]),
		);
		const destination = join(workspace, 'out');

		extractTarGz(archive, destination);

		expect(readFileSync(join(destination, 'package/dist/index.js'), 'utf8')).toBe(
			'export const ok = true;\n',
		);
	});

	test('支持 PAX 与 GNU 长路径记录', () => {
		const paxPath = `package/${'pax/'.repeat(24)}asset.txt`;
		const gnuPath = `package/${'gnu/'.repeat(24)}asset.txt`;
		const archive = writeArchive(
			createTar([
				{ name: 'PaxHeader', type: 'x', data: paxRecord('path', paxPath) },
				{ name: 'pax-placeholder', data: 'pax' },
				{ name: '././@LongLink', type: 'L', data: `${gnuPath}\0` },
				{ name: 'gnu-placeholder', data: 'gnu' },
			]),
		);
		const destination = join(workspace, 'out');

		extractTarGz(archive, destination);

		expect(readFileSync(join(destination, paxPath), 'utf8')).toBe('pax');
		expect(readFileSync(join(destination, gnuPath), 'utf8')).toBe('gnu');
	});

	test.each([
		'/absolute.txt',
		'../escape.txt',
		'safe/../../escape.txt',
		'C:/escape.txt',
		'C:\\escape.txt',
		'\\\\server\\share.txt',
		'safe\\escape.txt',
		'safe//escape.txt',
		'safe/CON.txt',
		'safe/trailing.',
	])('拒绝不可移植或可能逃逸的路径：%s', (name) => {
		const archive = writeArchive(createTar([{ name, data: 'unsafe' }]));
		const destination = join(workspace, 'out');

		expect(() => extractTarGz(archive, destination)).toThrow();
		expect(existsSync(destination) ? readdirSync(destination) : []).toEqual([]);
	});

	test('拒绝 PAX 路径穿越', () => {
		const archive = writeArchive(
			createTar([
				{ name: 'PaxHeader', type: 'x', data: paxRecord('path', '../escape.txt') },
				{ name: 'placeholder', data: 'unsafe' },
			]),
		);

		expect(() => extractTarGz(archive, join(workspace, 'out'))).toThrow();
	});

	test('拒绝重复目标和跨平台大小写碰撞', () => {
		for (const entries of [
			[
				{ name: 'package/file.txt', data: 'first' },
				{ name: 'package/file.txt', data: 'second' },
			],
			[
				{ name: 'package/File.txt', data: 'first' },
				{ name: 'package/file.txt', data: 'second' },
			],
		]) {
			const archive = writeArchive(createTar(entries));
			expect(() => extractTarGz(archive, join(workspace, 'out'))).toThrow();
		}
	});

	test.each(['1', '2'])('拒绝链接类型 %s', (type) => {
		const archive = writeArchive(
			createTar([{ name: 'package/link', type, linkName: '../outside', data: '' }]),
		);

		expect(() => extractTarGz(archive, join(workspace, 'out'))).toThrow();
	});

	test('拒绝文件父目录冲突、设备条目和不支持的 PAX 字段', () => {
		const archives = [
			createTar([
				{ name: 'package', data: 'file' },
				{ name: 'package/child.txt', data: 'child' },
			]),
			createTar([{ name: 'package/device', type: '3' }]),
			createTar([
				{ name: 'PaxHeader', type: 'x', data: paxRecord('linkpath', '../outside') },
				{ name: 'placeholder', data: 'unsafe' },
			]),
		];
		for (const tar of archives) {
			const archive = writeArchive(tar);
			expect(() => extractTarGz(archive, join(workspace, 'out'))).toThrow();
		}
	});

	test('拒绝校验和错误、截断以及缺少双结束块的归档', () => {
		const valid = createTar([{ name: 'package/file.txt', data: 'content' }]);
		const badChecksum = Buffer.from(valid);
		badChecksum[0] ^= 1;
		for (const tar of [badChecksum, valid.subarray(0, 700), valid.subarray(0, -512)]) {
			const archive = writeArchive(tar);
			expect(() => extractTarGz(archive, join(workspace, 'out'))).toThrow();
		}
	});

	test('拒绝向非空目标目录解包', () => {
		const archive = writeArchive(createTar([{ name: 'package/file.txt', data: 'content' }]));
		const destination = join(workspace, 'out');
		mkdirSync(destination);
		writeFileSync(join(destination, 'occupied.txt'), 'occupied');

		expect(() => extractTarGz(archive, destination)).toThrow();
	});
});
