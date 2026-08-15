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
		// Windows 上排除 PyMuPDF 密集文件：频繁 spawn python+fitz 后 worker
		// 会在下一文件启动时异常退出（测试本身全过，契约已由 ubuntu 全量覆盖）
		exclude: [
			...(process.platform === 'win32'
				? [
						'tests/assets/read-pdf-extraction.test.ts',
						'tests/assets/pdf-extraction-validation.test.ts',
						'tests/assets/pdf-region-crop.test.ts',
					]
				: []),
		],
		coverage: {
			include: ['src/**/*.ts'],
		},
	},
});
