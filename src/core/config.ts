import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function key32(name: string): Buffer {
  const key = Buffer.from(required(name), "base64");
  if (key.length !== 32) throw new Error(`${name} must be 32 random bytes, base64-encoded`);
  return key;
}

export const config = {
  encryptionKey: key32("ENCRYPTION_KEY"),
  phoneHashKey: key32("PHONE_HASH_KEY"),
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 5000),
  databaseUrl: required("DATABASE_URL"),
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  corsOrigins: (
    process.env.CORS_ORIGINS ??
    [3001, 3002, 3003, 3004].flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]).join(",")
  ).split(","),
};
