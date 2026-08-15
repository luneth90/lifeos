import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		testTimeout: 10000,
		// Windows runner（7GB）上 fork worker 堆上限过低时会在测试收尾崩溃
		// （Worker exited unexpectedly）；singleFork 串行 + 显式堆上限最稳
		pool: 'forks',
		poolOptions: {
			forks: { singleFork: true, execArgv: ['--max-old-space-size=4096'] },
		},
		coverage: {
			include: ['src/**/*.ts'],
		},
	},
});
