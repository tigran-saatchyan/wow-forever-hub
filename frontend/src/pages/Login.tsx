import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useLogin, useMe } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../theme/ThemeProvider";

export function Login() {
  const { t } = useI18n();
  const { sfx } = useTheme();
  const me = useMe();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (me.data) return <Navigate to="/" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => sfx("open"), onError: () => sfx("error") });
  };

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <form onSubmit={submit} className="panel space-y-4 p-6">
        <h1 className="panel-title text-center text-lg">Forever Hub</h1>
        <p className="text-center text-sm text-muted">{t("tagline")}</p>
        <label className="block space-y-1">
          <span className="eyebrow">{t("email")}</span>
          <input className="input w-full" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block space-y-1">
          <span className="eyebrow">{t("password")}</span>
          <input className="input w-full" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {login.isError && <p className="text-sm text-bad">{t("login_fail")}</p>}
        <button className="btn-primary w-full justify-center" disabled={login.isPending}>{t("nav_login")}</button>
      </form>
    </div>
  );
}
