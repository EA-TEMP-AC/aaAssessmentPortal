/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          strict: true,
          esModuleInterop: true,
          module: "commonjs",
          target: "ES2022",
          types: ["jest", "node"],
          isolatedModules: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
        },
      },
    ],
  },
};
