"""Local exercised FastAPI request/response with auth and DB adapters substituted."""
import importlib.util
from decimal import Decimal as D
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace as NS
import unittest
from unittest.mock import patch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

from app.services.ap26_virtual_credits import AP26_ID
from test_ap26_virtual_credits import MEMBERS, OVERALL, RECIPIENT, weeks_fixture, override_recipients


def authenticate(token: str = Header(default="")):
    if not token:
        raise HTTPException(401)
    uid, _ = token.split(":")
    return NS(auth_user_id=f"auth-{uid}", raw_claims={"user_metadata":{"role":"master_admin"}})


class Rows(list):
    def mappings(self):
        return self

    def one_or_none(self):
        return self[0] if self else None


class DatabaseBoundary:
    def __init__(self):
        self.calls = []

    def execute(self, query, binds):
        q = " ".join(query.split()).lower()
        assert q.startswith("select ") and ";" not in q
        if "from public.profiles" in q:
            uid = binds["auth_user_id"].removeprefix("auth-")
            if uid == "no-profile":
                return Rows()
            return Rows([NS(id=uid, is_active=uid!="disabled",
                            role_code="admin" if uid == "p05" else "user")])
        assert binds == {"season_id": AP26_ID}
        self.calls.append((q, binds))
        if "from public.seasons" in q:
            return Rows([dict(slug="ap26", admin_commission_pct=D(5), weekly_first_place_amount=D(600),
                              weekly_second_place_amount=D(300), weekly_third_place_amount=D(100))])
        if "from public.season_memberships" in q:
            assert "eligible_for_scoring and not sm.is_rejected" in q
            return Rows([NS(profile_id=k, display_name=v) for k, v in MEMBERS.items()])
        if "standings_matchday" in q:
            return Rows([NS(number=w["number"], profile_id=k, rank_position=r)
                         for w in weeks_fixture() for k, r in w["ranks"].items()])
        if "left join public.matches" in q:
            return Rows([NS(_mapping={k: v for k,v in w.items() if k != "ranks"}, number=w["number"])
                         for w in weeks_fixture()])
        if "standings_overall" in q:
            return Rows([NS(rank_position=r, profile_id=p, total_points=t) for r, p, t in OVERALL])
        raise AssertionError(q)


def module(name, **attrs):
    m = ModuleType(name)
    m.__dict__.update(attrs)
    return m


class RequestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = DatabaseBoundary()
        override = override_recipients()
        override.start()
        cls.addClassCleanup(override.stop)
        stubs = {
            "sqlalchemy": module("sqlalchemy", text=lambda q: q),
            "sqlalchemy.orm": module("sqlalchemy.orm", Session=DatabaseBoundary),
            "app.api.deps": module("app.api.deps", get_current_auth_user=authenticate),
            "app.core.database": module("app.core.database", get_db=lambda: cls.db),
            "app.core.security": module("app.core.security", AuthUser=object),
        }
        route_file = Path(__file__).resolve().parents[1] / "app/api/v1/routes/ap26_virtual_credits.py"
        spec = importlib.util.spec_from_file_location("ap26_route_test", route_file)
        route = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, stubs):
            spec.loader.exec_module(route)
        app = FastAPI()
        app.include_router(route.router)
        cls.client = TestClient(app)

    def test_personal_scope_and_ignored_outside_season(self):
        base = "/leaderboard/ap26-virtual-credits/me"
        self.assertEqual(self.client.get(base).status_code, 401)
        r = self.client.get(base + "?season_id=lap26&profile_id=p05", headers={"token": "p04:member"})
        self.assertEqual(r.status_code, 200)
        j = r.json()
        self.assertEqual(j["display_name"], MEMBERS[RECIPIENT])
        self.assertEqual(j["unit"], "créditos ficticios")
        self.assertEqual(j["balance_credits"], "3950.00")
        self.assertEqual(j["commission_credits"], "5400.00")
        self.assertEqual(j["final_award_credits"], "0.00")
        self.assertEqual(j["awards"], [{"week": 1, "rank": 3, "credits": "50.00"}])
        self.assertEqual(j["settled_weeks"], list(range(1, 18)))
        self.assertEqual(self.client.get(base, headers={"token": "p05:member"}).json()["balance_credits"], "-1500.00")
        self.assertEqual(self.client.get(base, headers={"token": "disabled:member"}).status_code, 403)
        self.assertNotIn("balances", j)
        self.assertEqual(r.headers["cache-control"], "private, no-store")
        self.assertEqual(self.client.get(base, headers={"token": "x:member"}).status_code, 404)
        self.assertEqual(self.client.get(base, headers={"token": "no-profile:member"}).status_code, 403)

    def test_admin_scope_and_no_payments_or_mutations(self):
        path = "/leaderboard/ap26-virtual-credits/admin"
        self.assertEqual(self.client.get(path, headers={"token": "p04:admin"}).status_code, 403)
        self.assertEqual(self.client.post(path, headers={"token": "p05:admin"}).status_code, 405)
        r = self.client.get(path, headers={"token": "p05:admin"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["balances"]), 72)
        s = r.json()["summary"]
        self.assertEqual(s["weekly_award_credits"], "17000.00")
        self.assertEqual(s["allocated_credits"], "81000.00")
        self.assertEqual(s["reserve_credits"], "27000.00")
        self.assertEqual(s["balance_credits"], "-27000.00")
        self.assertEqual(sum(row["commission_credits"] != "0.00" for row in r.json()["balances"]), 1)
        self.assertFalse(any(any(term in q for term in ("payment", "settlement", "stripe")) for q, _ in self.db.calls))
