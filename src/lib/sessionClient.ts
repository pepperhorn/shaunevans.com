import { persistentAtom } from "@nanostores/persistent";

export type ClientSession = {
  token: string;
  user_id: number;
  email: string;
  name: string | null;
} | null;

export const session = persistentAtom<ClientSession>("se:session", null, {
  encode: JSON.stringify,
  decode: JSON.parse,
});

export function setSession(value: NonNullable<ClientSession>) {
  session.set(value);
}

export function clearSession() {
  session.set(null);
}
