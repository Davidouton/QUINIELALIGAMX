"""PostgreSQL/Supabase repository. Uses a direct or session-pooler connection."""

import json
import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

LOCK_ID = 724019321


def records(frame):
    return json.loads(frame.to_json(orient="records", date_format="iso"))


@contextmanager
def connection():
    from app.core.config import get_settings

    url = os.environ.get("NFL_PREDICTOR_DATABASE_URL") or get_settings().database_url
    url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    if not url:
        raise ValueError("Configura DATABASE_URL de Supabase (conexión directa o Session pooler).")
    from urllib.parse import urlparse

    if urlparse(url).port == 6543:
        raise ValueError("Usa Session pooler, puerto 5432, para el bloqueo del pipeline.")
    with psycopg.connect(
        url,
        connect_timeout=15,
        autocommit=True,
        row_factory=dict_row,
        sslmode=os.environ.get("PGSSLMODE", "require"),
    ) as conn:
        yield Store(conn)


class Store:
    def __init__(self, conn):
        self.conn = conn

    def migrate(self):
        self.conn.execute(Path(__file__).with_name("schema.sql").read_text())

    def lock(self):
        return self.conn.execute(
            "select pg_try_advisory_lock(%s) as acquired", (LOCK_ID,)
        ).fetchone()["acquired"]

    def unlock(self):
        self.conn.execute("select pg_advisory_unlock(%s)", (LOCK_ID,))

    def start(self, run_id):
        self.conn.execute(
            "update public.nfp_runs set status='failed',finished_at=now(),stage='interrupted' where status='running'"
        )
        self.conn.execute("insert into public.nfp_runs(id,status) values (%s,'running')", (run_id,))

    def progress(self, run_id, stage):
        self.conn.execute("update public.nfp_runs set stage=%s where id=%s", (stage, run_id))

    def finish(self, run_id, status, details):
        self.conn.execute(
            "update public.nfp_runs set status=%s,finished_at=now(),details=%s where id=%s",
            (status, Jsonb(details), run_id),
        )

    def games(self):
        return [
            r["payload"]
            for r in self.conn.execute(
                "select payload from public.nfp_games order by season,week,game_id"
            )
        ]

    def save_games(self, rows):
        with self.conn.transaction():
            with self.conn.cursor() as cur:
                cur.executemany(
                    """insert into public.nfp_games(game_id,season,week,kickoff_at,home_team,away_team,payload)
                  values (%s,%s,%s,%s,%s,%s,%s) on conflict(game_id) do update set
                  kickoff_at=excluded.kickoff_at,payload=excluded.payload,updated_at=now()""",
                    [
                        (
                            r["Game_ID"],
                            r["season"],
                            r["week"],
                            r.get("kickoff_at"),
                            r["home_team"],
                            r["away_team"],
                            Jsonb(r),
                        )
                        for r in rows
                    ],
                )

    def metrics(self):
        return [
            r["payload"]
            for r in self.conn.execute(
                "select payload from public.nfp_team_metrics order by season,game_id,team"
            )
        ]

    def save_metrics(self, rows):
        with self.conn.transaction():
            with self.conn.cursor() as cur:
                cur.executemany(
                    """insert into public.nfp_team_metrics(season,game_id,team,payload) values (%s,%s,%s,%s)
                on conflict(season,game_id,team) do update set payload=excluded.payload,updated_at=now()""",
                    [(r["season"], r["game_id"], r["team"], Jsonb(r)) for r in rows],
                )

    def save_odds(self, run_id, rows):
        with self.conn.transaction():
            for r in rows:
                self.conn.execute(
                    """insert into public.nfp_odds(run_id,game_id,captured_at,bookmaker,payload)
                  values(%s,%s,%s,%s,%s) on conflict do nothing""",
                    (run_id, r["Game_ID"], r["captured_at"], r["bookmaker"], Jsonb(r)),
                )

    def publish(self, run_id, preds, bets, details):
        with self.conn.transaction():
            for p in records(preds):
                matching = bets[bets.Game_ID.astype(str) == str(p["Game_ID"])]
                self.conn.execute(
                    """insert into public.nfp_predictions(run_id,game_id,season,week,payload,bets)
                 values(%s,%s,%s,%s,%s,%s)""",
                    (
                        run_id,
                        p["Game_ID"],
                        p["season"],
                        p["week"],
                        Jsonb(p),
                        Jsonb(records(matching)),
                    ),
                )
            self.finish(run_id, "complete", details)

    def dashboard(self, season=None, week=None):
        if season is None and week is None:
            latest = self.conn.execute(
                "select p.season,p.week from public.nfp_predictions p join public.nfp_runs r on p.run_id=r.id where r.status='complete' order by r.started_at desc limit 1"
            ).fetchone()
            if latest:
                season, week = latest["season"], latest["week"]
        clauses = ["r.status='complete'"]
        params = []
        if season is not None:
            clauses.append("p.season=%s")
            params.append(season)
        if week is not None:
            clauses.append("p.week=%s")
            params.append(week)
        query = (
            """select distinct on(p.game_id) p.payload,p.bets,r.id as run_id,r.started_at,g.payload as game
         from public.nfp_predictions p join public.nfp_runs r on r.id=p.run_id
         join public.nfp_games g on g.game_id=p.game_id where """
            + " and ".join(clauses)
            + """ order by p.game_id,r.started_at desc limit 400"""
        )
        result = list(self.conn.execute(query, params))
        runs = list(
            self.conn.execute("select * from public.nfp_runs order by started_at desc limit 10")
        )
        periods = list(
            self.conn.execute(
                "select distinct season,week from public.nfp_games order by season desc,week"
            )
        )
        return {"predictions": result, "runs": runs, "periods": periods}
