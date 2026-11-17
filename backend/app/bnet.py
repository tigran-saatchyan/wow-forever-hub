"""Blizzard Battle.net API client for WoW: Forever.

Forever has its own namespaces: static-forever-{region} (items, classes), dynamic-forever-{region}
(rulesets, auction houses) and profile-forever-{region} (characters, guilds). There are no realms:
a character is looked up by "name-surname", and the realm and connected-realm indexes answer 404.
Static data has also been seen only under a versioned name (static-1.60.1_70399-forever-eu), so a
refused plain static namespace is retried with the current build's version.

None of this is documented by Blizzard yet; it comes from community probes (November 2026). The
probe() below lists what actually answers, so the hub can show it instead of us guessing.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from .config import Settings, get_settings

REGIONS = ("eu", "us")
LOCALES = {"ru": "ru_RU", "en": "en_US"}
TOKEN_URL = "https://oauth.battle.net/token"


class BnetError(Exception):
    def __init__(self, status: int, path: str, detail: str = ""):
        super().__init__(f"{status} {path} {detail}".strip())
        self.status, self.path, self.detail = status, path, detail


class NotConfigured(BnetError):
    def __init__(self):
        super().__init__(503, "", "Blizzard API keys are not set (FH_BNET_CLIENT_ID / FH_BNET_CLIENT_SECRET)")


def slug(name: str) -> str:
    """Blizzard's slug: lower case, spaces to hyphens. "Joe Gun" -> "joe-gun"."""
    return "-".join(name.strip().lower().split())


def current_version(s: Settings) -> str | None:
    """Latest client build from data/index.json, in the namespace form 1.60.1_70755."""
    try:
        v = json.loads((s.data_dir / "index.json").read_text("utf-8"))["latest"]
    except (OSError, ValueError, KeyError):
        return None
    head, _, build = str(v).rpartition(".")
    return f"{head}_{build}" if head else None


@dataclass
class Probe:
    name: str
    path: str
    namespace: str
    status: int
    ms: int
    sample: str


class Bnet:
    """One shared client. Tests pass an httpx.MockTransport."""

    def __init__(self, settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None):
        self.s = settings or get_settings()
        self.http = httpx.AsyncClient(timeout=20, transport=transport, headers={"User-Agent": "ForeverHub/0.2"})
        self._token: tuple[str, float] | None = None
        self._lock = asyncio.Lock()
        self._static_ns: dict[str, str] = {}  # region -> namespace that answered last

    @property
    def configured(self) -> bool:
        return bool(self.s.bnet_client_id and self.s.bnet_client_secret)

    async def token(self) -> str:
        if not self.configured:
            raise NotConfigured()
        async with self._lock:
            if self._token and self._token[1] > time.time() + 60:
                return self._token[0]
            r = await self.http.post(
                TOKEN_URL,
                data={"grant_type": "client_credentials"},
                auth=(self.s.bnet_client_id, self.s.bnet_client_secret),
            )
            if r.status_code != 200:
                raise BnetError(r.status_code, "oauth/token", r.text[:200])
            j = r.json()
            self._token = (j["access_token"], time.time() + int(j.get("expires_in", 3600)))
            return self._token[0]

    def namespace(self, kind: str, region: str) -> str:
        if kind == "static":
            return self._static_ns.get(region, f"static-forever-{region}")
        return f"{kind}-forever-{region}"

    async def _get(self, path: str, namespace: str, region: str, locale: str | None, token: str | None,
                   extra: dict[str, str] | None = None):
        params = {"namespace": namespace}
        if locale:
            params["locale"] = locale
        url = path if path.startswith("http") else f"https://{region}.api.blizzard.com{path}"
        headers = {"Authorization": f"Bearer {token or await self.token()}", **(extra or {})}
        return await self.http.get(url, params=params, headers=headers)

    async def get_if_newer(self, path: str, kind: str, region: str | None, since: str | None
                           ) -> tuple[dict[str, Any] | None, str | None]:
        """GET a dynamic resource only if it changed since `since` (its Last-Modified, as given back before).

        Returns (data, last_modified); data is None when Blizzard answers 304 Not Modified: a short answer
        that costs nothing to fetch, so a resource that changes hourly can be watched every few minutes.
        last_modified is None when the server sends none."""
        region = (region or self.s.bnet_region).lower()
        if region not in REGIONS:
            raise BnetError(400, path, f"unknown region {region}")
        r = await self._get(path, self.namespace(kind, region), region, None, None,
                            {"If-Modified-Since": since} if since else None)
        if r.status_code == 304:
            return None, since
        if r.status_code != 200:
            raise BnetError(r.status_code, path, r.text[:200])
        return r.json(), r.headers.get("last-modified")

    async def get(
        self, path: str, kind: str, region: str | None = None, lang: str | None = None, token: str | None = None
    ) -> dict[str, Any]:
        """GET a Game Data or Profile resource. `kind` is static | dynamic | profile.

        `token` is a user's token (Battle.net sign-in); otherwise the app's client token is used.
        """
        region = (region or self.s.bnet_region).lower()
        if region not in REGIONS:
            raise BnetError(400, path, f"unknown region {region}")
        locale = LOCALES.get(lang or "", None)
        ns = self.namespace(kind, region)
        r = await self._get(path, ns, region, locale, token)
        if kind == "static" and r.status_code in (403, 404):
            # Forever's static data answers under the plain or the versioned name, item by item:
            # try the other one before giving up, and remember which one answered
            ver = current_version(self.s)
            plain = f"static-forever-{region}"
            alt = plain if ns != plain else (f"static-{ver}-forever-{region}" if ver else None)
            if alt:
                r2 = await self._get(path, alt, region, locale, token)
                if r2.status_code == 200:
                    self._static_ns[region] = alt
                    r = r2
        if r.status_code != 200:
            raise BnetError(r.status_code, path, r.text[:200])
        return r.json()

    async def probe(self, region: str | None = None, character: str | None = None) -> list[Probe]:
        """Ask every endpoint the hub uses and report what answers, without raising."""
        region = (region or self.s.bnet_region).lower()
        ver = current_version(self.s)
        checks: list[tuple[str, str, str]] = [
            ("rulesets", "/data/wow/ruleset/index", f"dynamic-forever-{region}"),
            ("realms", "/data/wow/realm/index", f"dynamic-forever-{region}"),
            ("classes", "/data/wow/playable-class/index", f"static-forever-{region}"),
            ("item", "/data/wow/item/19019", f"static-forever-{region}"),
            ("item media", "/data/wow/media/item/19019", f"static-forever-{region}"),
            ("item search", "/data/wow/search/item?name.en_US=Thunderfury", f"static-forever-{region}"),
        ]
        if ver:
            checks.append(("item (versioned)", "/data/wow/item/19019", f"static-{ver}-forever-{region}"))
        out: list[Probe] = []
        try:
            tok = await self.token()
        except BnetError as e:
            return [Probe("oauth", "oauth/token", "", e.status, 0, e.detail[:160])]

        async def one(name: str, path: str, ns: str) -> Probe:
            t0 = time.monotonic()
            try:
                url = f"https://{region}.api.blizzard.com{path}"
                sep = "&" if "?" in url else "?"
                r = await self.http.get(
                    f"{url}{sep}namespace={ns}&locale=en_US", headers={"Authorization": f"Bearer {tok}"}
                )
                st, body = r.status_code, r.text
            except httpx.HTTPError as e:
                st, body = 0, str(e)
            return Probe(name, path, ns, st, int((time.monotonic() - t0) * 1000), " ".join(body.split())[:160])

        out += await asyncio.gather(*(one(*c) for c in checks))
        # the first ruleset's auction houses, and a character with its sub-resources
        rules = next((p for p in out if p.name == "rulesets" and p.status == 200), None)
        if rules:
            try:
                rid = first_id(json.loads((await self.http.get(
                    f"https://{region}.api.blizzard.com/data/wow/ruleset/index?namespace=dynamic-forever-{region}",
                    headers={"Authorization": f"Bearer {tok}"},
                )).text), "rulesets")
            except (ValueError, httpx.HTTPError):
                rid = None
            if rid is not None:
                houses = f"/data/wow/ruleset/{rid}/auctions/"
                out.append(await one("auction houses", houses, f"dynamic-forever-{region}"))
        if character:
            base = f"/profile/wow/character/{quote(slug(character))}"
            ns = f"profile-forever-{region}"
            out += await asyncio.gather(*(
                one(f"character{suffix or ''}", base + suffix, ns)
                for suffix in ("", "/equipment", "/specializations", "/character-media", "/statistics")
            ))
        return out

    async def aclose(self) -> None:
        await self.http.aclose()


def first_id(data: Any, key: str) -> int | None:
    xs = data.get(key) if isinstance(data, dict) else None
    if isinstance(xs, list):
        for x in xs:
            if isinstance(x, dict) and "id" in x:
                return x["id"]
    return None


def name_of(x: Any, lang: str | None = None) -> str:
    """A Blizzard name: plain string, or {"en_US": …, "ru_RU": …} when no locale was asked."""
    if isinstance(x, dict):
        if "name" in x:
            return name_of(x["name"], lang)
        loc = LOCALES.get(lang or "", "en_US")
        return x.get(loc) or x.get("en_US") or next((v for v in x.values() if isinstance(v, str)), "")
    return x if isinstance(x, str) else ""


_client: Bnet | None = None


def client() -> Bnet:
    global _client
    if _client is None:
        _client = Bnet()
    return _client


def set_client(c: Bnet | None) -> None:
    """Tests swap in a client with a mock transport."""
    global _client
    _client = c
