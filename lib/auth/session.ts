import { cookies } from "next/headers";
import { getServerConfig } from "@/lib/config/env";

export type AppUser = {
  id: string;
  displayName: string;
  role: "owner";
};

const SESSION_COOKIE = "groww_scanner_session";

export async function getOptionalAppUser(): Promise<AppUser | null> {
  const config = getServerConfig();

  if (config.marketDataMode === "simulation" && !config.appAuthSecret) {
    return {
      id: "simulation-owner",
      displayName: "Simulation Owner",
      role: "owner",
    };
  }

  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(SESSION_COOKIE)?.value;

  if (!sessionValue || !config.appAuthSecret) {
    return null;
  }

  return {
    id: "authenticated-owner",
    displayName: "Owner",
    role: "owner",
  };
}

export async function requireAppUser(): Promise<AppUser> {
  const user = await getOptionalAppUser();

  if (!user) {
    throw new Error("Authentication required.");
  }

  return user;
}
