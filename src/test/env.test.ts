import { Client } from "pg";

describe("test database", () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => client.connect());
  afterAll(() => client.end());

  it("is kenroute_test, not the dev database", async () => {
    const r = await client.query("SELECT current_database() AS name");
    expect(r.rows[0].name).toBe("kenroute_test");
  });

  it("has the migration applied, including the hand-added seat index", async () => {
    const tables = await client.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'",
    );
    expect(tables.rows[0].n).toBe(22);
    const index = await client.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'booking_active_seat'");
    expect(index.rows[0].indexdef).toContain("UNIQUE");
    expect(index.rows[0].indexdef).toContain("WHERE");
  });
});
