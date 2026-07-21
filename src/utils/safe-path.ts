import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | null {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

/** 返回已解析符号链接的真实 Vault 根目录。所有写闸和升级路径都以此为身份。 */
export function canonicalVaultRoot(vaultRoot: string): string {
	const requested = resolve(vaultRoot);
	if (!existsSync(requested)) throw new Error(`Vault 不存在：${requested}`);
	const canonical = realpathSync.native(requested);
	if (!statSync(canonical).isDirectory()) throw new Error(`Vault 不是目录：${canonical}`);
	return canonical;
}

/**
 * 返回稳定的 Vault 位置；仅供外部 cutover 恢复使用。
 * 当根目录在原子替换窗口中暂时不存在时，以真实父目录和原目录名重建同一身份。
 */
export function canonicalVaultLocation(vaultRoot: string): string {
	const requested = resolve(vaultRoot);
	if (existsSync(requested)) return canonicalVaultRoot(requested);
	const parent = realpathSync.native(resolve(requested, '..'));
	if (!statSync(parent).isDirectory()) throw new Error(`Vault 父目录不是目录：${parent}`);
	return join(parent, basename(requested));
}

function containedRelative(root: string, target: string): string {
	const rel = relative(root, target);
	if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
		throw new Error(`路径必须位于 Vault 内：${target}`);
	}
	return rel;
}

/**
 * 验证 Vault 内路径的所有已存在组件均不是符号链接。
 * 未存在的尾部组件由同一进程随后创建；现存父链必须保持在真实 Vault 内。
 */
export function assertVaultPathSafe(vaultRoot: string, target: string): string {
	const requestedRoot = resolve(vaultRoot);
	const root = canonicalVaultRoot(vaultRoot);
	const requestedTarget = resolve(target);
	let rel: string;
	try {
		rel = containedRelative(root, requestedTarget);
	} catch {
		rel = containedRelative(requestedRoot, requestedTarget);
	}
	const resolvedTarget = resolve(root, rel);
	let current = root;
	for (const component of rel.split(sep)) {
		current = join(current, component);
		const stat = lstatIfPresent(current);
		if (!stat) break;
		if (stat.isSymbolicLink()) {
			throw new Error(`拒绝通过符号链接修改 Vault：${current}`);
		}
	}
	return resolvedTarget;
}

/** 验证一个受管目录树内没有可将覆盖写入重定向到外部的符号链接。 */
export function assertManagedTreeSafe(vaultRoot: string, target: string): void {
	const safeTarget = assertVaultPathSafe(vaultRoot, target);
	if (!lstatIfPresent(safeTarget)) return;
	const visit = (path: string): void => {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) throw new Error(`受管目录包含符号链接：${path}`);
		if (!stat.isDirectory()) return;
		for (const entry of readdirSync(path)) visit(join(path, entry));
	};
	visit(safeTarget);
}
