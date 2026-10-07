import { prisma } from "../../core/db";

// The seat plans drawn on the Admin Seat Layouts screen, one per kind of bus.
// Positions follow that screen exactly, so an agent sees the same bus the owner does:
//   2+1 buses: column 0 = single side, 1 = aisle, 2 and 3 = the pair side
//   2+2 buses: columns 0,1 | 2 = aisle | 3,4
// `row` counts from the front of the bus.

export type Seating = "SLEEPER" | "SEATER" | "SEATER_SLEEPER";
/** A sleeper comes with or without one extra bed across the back of the lower deck. */
type PlanKey = Seating | "SLEEPER_37";
type Kind = "sleeper" | "seater";
type Side = { rows: number; kind: Kind } | null;
interface DeckPlan {
  single: Side;
  pair: Side;
  backBench: boolean;
  /** One single bed in the aisle position behind the last row. */
  backBerth?: boolean;
}
interface Plan {
  name: string;
  arrangement: "2-1" | "2-2";
  lower: DeckPlan;
  upper: DeckPlan | null;
}

const PLANS: Record<PlanKey, Plan> = {
  // 6 single beds and 6 double beds on each deck.
  SLEEPER: {
    name: "Sleeper (2+1)",
    arrangement: "2-1",
    lower: { single: { rows: 6, kind: "sleeper" }, pair: { rows: 6, kind: "sleeper" }, backBench: false },
    upper: { single: { rows: 6, kind: "sleeper" }, pair: { rows: 6, kind: "sleeper" }, backBench: false },
  },
  // The same bus with a 37th bed (L19) across the back of the lower deck.
  SLEEPER_37: {
    name: "Sleeper (2+1) 37",
    arrangement: "2-1",
    lower: { single: { rows: 6, kind: "sleeper" }, pair: { rows: 6, kind: "sleeper" }, backBench: false, backBerth: true },
    upper: { single: { rows: 6, kind: "sleeper" }, pair: { rows: 6, kind: "sleeper" }, backBench: false },
  },
  // 10 rows of four and a five-seat back bench, one deck.
  SEATER: {
    name: "Seater (2+2)",
    arrangement: "2-2",
    lower: { single: { rows: 10, kind: "seater" }, pair: { rows: 10, kind: "seater" }, backBench: true },
    upper: null,
  },
  // Lower deck: beds on the single side, seats on the pair side. Upper deck: all beds.
  SEATER_SLEEPER: {
    name: "Seater/Sleeper (2+1)",
    arrangement: "2-1",
    lower: { single: { rows: 6, kind: "sleeper" }, pair: { rows: 12, kind: "seater" }, backBench: false },
    upper: { single: { rows: 6, kind: "sleeper" }, pair: { rows: 6, kind: "sleeper" }, backBench: false },
  },
};

export interface LayoutSeat {
  /** "L1", "U19": deck letter plus a number that runs across both decks. */
  number: string;
  deck: "LOWER" | "UPPER";
  row: number;
  col: number;
  /** SEATER, SLEEPER (a single bed) or DOUBLE_SLEEPER (one berth of a double bed); decides the fare. */
  type: "SEATER" | "SLEEPER" | "DOUBLE_SLEEPER";
  ladiesOnly: boolean;
}

/** Which plan a bus gets: a sleeper asked for with 37 seats has the back bed, every other bus the standard plan. */
export const planKey = (seating: Seating, seats?: number): PlanKey =>
  seating === "SLEEPER" && seats === 37 ? "SLEEPER_37" : seating;

export function designedSeats(key: PlanKey): LayoutSeat[] {
  const plan = PLANS[key];
  const singleCols = plan.arrangement === "2-1" ? [0] : [0, 1];
  const pairCols = plan.arrangement === "2-1" ? [2, 3] : [3, 4];
  const seats: LayoutSeat[] = [];
  let n = 1;

  const build = (deck: "LOWER" | "UPPER", d: DeckPlan) => {
    const add = (row: number, col: number, kind: Kind, onPairSide: boolean) => {
      const type = kind === "seater" ? "SEATER" : onPairSide ? "DOUBLE_SLEEPER" : "SLEEPER";
      seats.push({ number: `${deck === "LOWER" ? "L" : "U"}${n}`, deck, row, col, type, ladiesOnly: false });
      n++;
    };
    if (d.single) for (let r = 0; r < d.single.rows; r++) for (const c of singleCols) add(r, c, d.single.kind, false);
    if (d.pair) for (let r = 0; r < d.pair.rows; r++) for (const c of pairCols) add(r, c, d.pair.kind, true);
    if (d.backBench) {
      // The bench runs the full width, so the aisle position holds a seat too.
      const benchRow = Math.max(d.single?.rows ?? 0, d.pair?.rows ?? 0);
      const benchCols = plan.arrangement === "2-1" ? [2, 3, 1, 0] : [0, 1, 2, 3, 4];
      for (const c of benchCols) add(benchRow, c, d.pair?.kind ?? "seater", false);
    }
    if (d.backBerth) add(Math.max(d.single?.rows ?? 0, d.pair?.rows ?? 0), 1, "sleeper", false);
  };

  build("LOWER", plan.lower);
  if (plan.upper) build("UPPER", plan.upper);
  return seats;
}

/** The operator's layout for a kind of bus, created on first use. Buses of one kind share it. */
export async function layoutFor(operatorId: string, seating: Seating, seatCount?: number) {
  const key = planKey(seating, seatCount);
  const name = PLANS[key].name;
  const existing = await prisma.seatLayout.findFirst({ where: { operatorId, name } });
  if (existing) return existing;
  const seats = designedSeats(key);
  return prisma.seatLayout.create({
    data: { operatorId, name, totalSeats: seats.length, seats: seats as unknown as object[] },
  });
}
