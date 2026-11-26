"use client";

import { login } from "@/lib/api";
import { clearStoredAuthSession, getStoredAuthSession, setStoredAuthSession, type StoredAuthSession } from "@/store/auth";

let pendingValidation: Promise<StoredAuthSession | null> | undefined;

export function getValidatedAuthSession(): Promise<StoredAuthSession | null> {
  pendingValidation ??= validateAuthSession().finally(() => {
    pendingValidation = undefined;
  });
  return pendingValidation;
}

async function validateAuthSession(): Promise<StoredAuthSession | null> {
  const storedSession = await getStoredAuthSession();
  if (!storedSession) {
    return null;
  }

  try {
    const data = await login(storedSession.key);
    const nextSession: StoredAuthSession = {
      key: storedSession.key,
      role: data.role,
      subjectId: data.subject_id,
      name: data.name,
    };
    if (nextSession.role !== storedSession.role || nextSession.subjectId !== storedSession.subjectId || nextSession.name !== storedSession.name) {
      if ((await getStoredAuthSession())?.key === storedSession.key) {
        await setStoredAuthSession(nextSession);
      }
    }
    return nextSession;
  } catch {
    if ((await getStoredAuthSession())?.key === storedSession.key) {
      await clearStoredAuthSession();
    }
    return null;
  }
}
