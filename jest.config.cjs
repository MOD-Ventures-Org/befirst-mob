/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: 'node',
	testMatch: ['<rootDir>/src/pose-module/**/__tests__/**/*.test.ts'],
	transform: {
		'^.+\\.tsx?$': 'babel-jest',
	},
	moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
