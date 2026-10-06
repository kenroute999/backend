/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  // Points DATABASE_URL at the test database before any module loads.
  setupFiles: ["<rootDir>/src/test/setup-env.ts"],
};
