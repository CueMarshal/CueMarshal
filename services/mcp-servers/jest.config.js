const sharedConfig = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageReporters: ['text', 'lcov'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'ESNext',
        target: 'ES2020',
        moduleResolution: 'Node16',
        esModuleInterop: true,
        strict: true,
        skipLibCheck: true,
      },
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  testTimeout: 10000,
};

export default {
  projects: [
    {
      ...sharedConfig,
      displayName: 'shared',
      rootDir: '<rootDir>/shared',
      roots: ['<rootDir>/src'],
    },
    {
      ...sharedConfig,
      displayName: 'conductor-mcp',
      rootDir: '<rootDir>/conductor-mcp',
      roots: ['<rootDir>/src'],
    },
    {
      ...sharedConfig,
      displayName: 'gitea-mcp',
      rootDir: '<rootDir>/gitea-mcp',
      roots: ['<rootDir>/src'],
    },
    {
      ...sharedConfig,
      displayName: 'system-mcp',
      rootDir: '<rootDir>/system-mcp',
      roots: ['<rootDir>/src'],
    },
  ],
};
