import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 5000),
  databaseUrl: required("DATABASE_URL"),
  corsOrigins: (
    process.env.CORS_ORIGINS ??
    [3001, 3002, 3003].flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]).join(",")
  ).split(","),
};
