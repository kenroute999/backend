import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../core/accounts";
import { decrypt } from "../../core/crypto";
import { prisma } from "../../core/db";
import { bookingInput, cancelBooking, createBooking } from "../booking/service";

// The owner's view of every booking on every channel, by every agent.
export const ownerBookingsRouter = Router();

// ponytail: latest 500 in one page, filtered in the browser; add paging and server-side
// filters when an operator's bookings outgrow that.
ownerBookingsRouter.get("/", async (req, res) => {
  // `boarded=true|false` narrows to passengers the conductor has, or has not, boarded.
  const { boarded } = z.object({ boarded: z.enum(["true", "false"]).optional() }).parse(req.query);
  const rows = await prisma.booking.findMany({
    where: { operatorId: req.operatorId, ...(boarded && { passenger: { boarded: boarded === "true" } }) },
    select: {
      id: true,
      pnr: true,
      status: true,
      source: true,
      fare: true,
      paymentMode: true,
      boardingPoint: true,
      droppingPoint: true,
      createdAt: true,
      channel: { select: { type: true } },
      agent: { select: { id: true, name: true, agentCode: true } },
      tripSeat: { select: { seatNumber: true, deck: true } },
      trip: {
        select: {
          departureAt: true,
          arrivalAt: true,
          route: { select: { origin: true, destination: true } },
          bus: { select: { registrationNo: true, name: true } },
        },
      },
      passenger: {
        select: {
          name: true,
          age: true,
          gender: true,
          phoneEnc: true,
          idProofType: true,
          boarded: true,
          boardedAt: true,
          boardedBy: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const items = rows.map(({ tripSeat, passenger, channel, ...b }) => ({
    ...b,
    channel: channel.type,
    seatNumber: tripSeat.seatNumber,
    deck: tripSeat.deck,
    // The owner may see the passenger's phone; the ID proof number is never sent, only its type.
    passenger: passenger && {
      name: passenger.name,
      age: passenger.age,
      gender: passenger.gender,
      phone: decrypt(passenger.phoneEnc),
      idProofType: passenger.idProofType,
      // Boarding is recorded by the conductor's app; it is separate from the booking's status.
      boarded: passenger.boarded,
      boardedAt: passenger.boardedAt,
      boardedBy: passenger.boardedBy?.name ?? null,
    },
  }));
  res.json({ items, total: items.length });
});

// The owner books at the office counter: same rules as an agent, but no agent and no commission.
ownerBookingsRouter.post("/", async (req, res) => {
  res.status(201).json(await createBooking({ operatorId: req.operatorId }, bookingInput.parse(req.body)));
});

// The owner can cancel any ticket of their operator, under the same rules as an agent.
ownerBookingsRouter.post("/:id/cancel", async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await cancelBooking({ id, operatorId: req.operatorId }));
});
