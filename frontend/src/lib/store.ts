/** localStorage wrapper for per-browser conveniences; every access may throw (private mode). */
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem("fh." + k);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem("fh." + k, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
};
