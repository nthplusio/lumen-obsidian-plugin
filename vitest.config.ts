import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/**/*.{test,spec}.ts'],
		exclude: ['node_modules', 'main.js'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'json-summary'],
			include: ['src/**/*.ts'],
			exclude: [
				'src/main.ts',
				'src/settings-tab.ts',
			],
		},
		alias: {
			obsidian: path.resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
		},
	},
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, 'tests/__mocks__/obsidian.ts'),
		},
	},
});
