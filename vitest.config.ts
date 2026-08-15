import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		testTimeout: 10000,
		// threads 池：Windows 上 fork 池在 PyMuPDF 密集测试后 worker 收尾会
		// 异常退出（Worker exited unexpectedly），threads 无子进程边界更稳定
		pool: 'threads',
		coverage: {
			include: ['src/**/*.ts'],
		},
	},
});
