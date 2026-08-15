import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		testTimeout: 10000,
		// Windows 上 fork 多 worker 并发时 PyMuPDF 密集测试的 worker 收尾会异常
		// 退出，threads 池则主进程收尾异常；singleFork 单 worker 串行最稳定
		pool: 'forks',
		poolOptions: {
			forks: { singleFork: true },
		},
		coverage: {
			include: ['src/**/*.ts'],
		},
	},
});
