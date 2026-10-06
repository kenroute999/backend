import "dotenv/config";

// Tests must never touch dev data: refuse to run without a dedicated test database.
const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) throw new Error("DATABASE_URL_TEST is not set");
if (testUrl === process.env.DATABASE_URL) throw new Error("DATABASE_URL_TEST must differ from DATABASE_URL");

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = "test";
