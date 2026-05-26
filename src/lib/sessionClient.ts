import { atom, onMount } from "nanostores";

export type ClientSession = {
  user_id: number;
  email: string;
  name: string | null;
} | null;

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: NonNullable<ClientSession> };

export const sessionState = atom<SessionState>({ status: "loading" });

async function loadSession() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) {
      sessionState.set({ status: "anonymous" });
      return;
    }
    const j = (await res.json()) as { user?: NonNullable<ClientSession> };
    if (j.user) {
      sessionState.set({ status: "authenticated", user: j.user });
    } else {
      sessionState.set({ status: "anonymous" });
    }
  } catch {
    sessionState.set({ status: "anonymous" });
  }
}

onMount(sessionState, () => {
  void loadSession();
});

export function setSessionUser(user: NonNullable<ClientSession>) {
  sessionState.set({ status: "authenticated", user });
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/signout", {
    method: "POST",
    credentials: "same-origin",
  });
  sessionState.set({ status: "anonymous" });
}

export function refreshSession() {
  return loadSession();
}
