import type { SavedBuild } from "../engine";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(r.status, msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export const data = <T>(path: string) => req<T>("/data/" + path);

export interface Me {
  id: number;
  email: string;
  role: "superadmin" | "member";
}

export const api = {
  me: () => req<Me>("/api/auth/me"),
  login: (email: string, password: string) =>
    req<Me>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => req<void>("/api/auth/logout", { method: "POST" }),
  builds: () => req<SavedBuild[]>("/api/builds"),
  saveBuild: (b: Omit<SavedBuild, "id" | "created" | "updated"> & { id?: string }) =>
    req<SavedBuild>("/api/builds", { method: "PUT", body: JSON.stringify(b) }),
  deleteBuild: (id: string) => req<void>(`/api/builds/${id}`, { method: "DELETE" }),
};
