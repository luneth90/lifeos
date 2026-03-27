import { createHash } from 'node:crypto';

export interface ManagedAssetRecord {
	version: string;
	sha256: string;
}

export type ManagedAssetsMap = Record<string, ManagedAssetRecord>;

export function sha256Content(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

export function buildManagedAssetRecord(content: string, version: string): ManagedAssetRecord {
	return {
		version,
		sha256: sha256Content(content),
	};
}

export function cloneManagedAssets(managedAssets?: ManagedAssetsMap): ManagedAssetsMap {
	return { ...(managedAssets ?? {}) };
}

export function isManagedAssetRecord(value: unknown): value is ManagedAssetRecord {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as ManagedAssetRecord).version === 'string' &&
		typeof (value as ManagedAssetRecord).sha256 === 'string'
	);
}
