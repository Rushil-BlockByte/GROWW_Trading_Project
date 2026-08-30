import { MARKET_SESSION } from "@/lib/config/market";

const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type SessionWindow = {
  open: string;
  close: string;
};

export const DEFAULT_INTRADAY_SESSION: SessionWindow = {
  open: MARKET_SESSION.open,
  close: MARKET_SESSION.equityClose,
};

function parseClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);

  return hours * 60 + minutes;
}

export function getKolkataMinutesOfDay(date: Date) {
  const shifted = new Date(date.getTime() + KOLKATA_OFFSET_MS);

  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function isInsideKolkataSession(
  date: Date,
  session: SessionWindow = DEFAULT_INTRADAY_SESSION,
) {
  const minutes = getKolkataMinutesOfDay(date);
  const open = parseClock(session.open);
  const close = parseClock(session.close);

  return minutes >= open && minutes < close;
}

export function floorToKolkataIntervalStart(
  date: Date,
  intervalMinutes: number,
  session: SessionWindow = DEFAULT_INTRADAY_SESSION,
) {
  if (!isInsideKolkataSession(date, session)) {
    return undefined;
  }

  const shifted = new Date(date.getTime() + KOLKATA_OFFSET_MS);
  const sessionOpen = parseClock(session.open);
  const minutesOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const minutesFromOpen = minutesOfDay - sessionOpen;
  const bucketOffset = Math.floor(minutesFromOpen / intervalMinutes) * intervalMinutes;
  const bucketMinutes = sessionOpen + bucketOffset;
  const bucketStartShifted = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      Math.floor(bucketMinutes / 60),
      bucketMinutes % 60,
      0,
      0,
    ),
  );

  return new Date(bucketStartShifted.getTime() - KOLKATA_OFFSET_MS);
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}
