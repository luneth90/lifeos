import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		testTimeout: 10000,
		// Windows 上 fork 池 worker 在数据库密集文件后收尾异常退出（vitest/
		// better-sqlite3/Windows 组合问题，测试本身全过）；threads 单线程无
		// 子进程边界最稳定，macOS 与 ubuntu 全量无回归
		pool: 'threads',
		poolOptions: {
			threads: { singleThread: true },
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
