#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import text

API_BASE = "https://api.football-md.com/api/v1"
DEFAULT_COMPETITION_ID = 205
DEFAULT_OUTPUT_PATH = Path("app/data/quiniela_plus_advanced_stats.json")
ROOT_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT_DIR.parent

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core.team_matching import EQUIVALENT_TEAM_CODES, TEAM_CODE_ALIASES, normalize_text  # noqa: E402


def pct(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return 0.0


def parse_date(value: str) -> date:
    return date.fromisoformat(value)


def normalize_score(score: Any) -> str:
    if isinstance(score, list | tuple) and len(score) == 2:
        return f"{score[0]}-{score[1]}"
    return str(score or "")


def implied_odds_from_prob(probability: float) -> float:
    if probability <= 0:
        return 0.0
    return round(1 / (probability / 100), 3)


def scoreline_map(goal_grid: Iterable[dict[str, Any]]) -> dict[str, float]:
    result: dict[str, float] = {}
    for item in goal_grid:
        home_goals = item.get("home_goals")
        away_goals = item.get("away_goals")
        if home_goals is None or away_goals is None:
            continue
        result[f"{home_goals}-{away_goals}"] = pct(item.get("probability"))
    return result


def goal_grid_probability(
    goal_grid: Iterable[dict[str, Any]],
    predicate: Any,
) -> float:
    return round(sum(pct(item.get("probability")) for item in goal_grid if predicate(item)), 2)


def over_under(goal_grid: list[dict[str, Any]], threshold: float) -> tuple[float, float]:
    over = goal_grid_probability(
        goal_grid,
        lambda item: (item.get("home_goals", 0) + item.get("away_goals", 0)) > threshold,
    )
    under = goal_grid_probability(
        goal_grid,
        lambda item: (item.get("home_goals", 0) + item.get("away_goals", 0)) <= threshold,
    )
    return over, under


def fetch_json(client: httpx.Client, path: str) -> dict[str, Any]:
    response = client.get(path)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"Football data API returned a non-object payload for {path}")
    return payload


def normalize_fixture(fixture: dict[str, Any], details: dict[str, Any]) -> dict[str, Any]:
    goal_grid = details.get("goal_grid") if isinstance(details.get("goal_grid"), list) else []
    scoreline_probabilities = scoreline_map(goal_grid)

    home_probability = pct(details.get("win_prob"))
    draw_probability = pct(details.get("draw_prob"))
    away_probability = pct(details.get("loss_prob"))
    implied_home = implied_odds_from_prob(home_probability)
    implied_draw = implied_odds_from_prob(draw_probability)
    implied_away = implied_odds_from_prob(away_probability)
    over_0_5, under_0_5 = over_under(goal_grid, 0.5)
    over_1_5, under_1_5 = over_under(goal_grid, 1.5)
    over_2_5, under_2_5 = over_under(goal_grid, 2.5)
    over_3_5, under_3_5 = over_under(goal_grid, 3.5)

    row = {
        "fixture_id": details.get("fixture_id") or fixture.get("id"),
        "date": fixture.get("date") or details.get("date"),
        "kickoff_at": fixture.get("kickoff_at") or details.get("kickoff_at"),
        "round": fixture.get("round"),
        "group": fixture.get("group_name"),
        "home": details.get("home_team") or fixture.get("home_club"),
        "away": details.get("away_team") or fixture.get("away_club"),
        "home_win_prob": home_probability,
        "draw_prob": draw_probability,
        "away_win_prob": away_probability,
        "xg_home": pct(details.get("xg_home")),
        "xg_away": pct(details.get("xg_away")),
        "most_likely_score": normalize_score(details.get("most_likely_score")),
        "most_likely_score_prob": pct(details.get("most_likely_score_prob")),
        "implied_odds_home": implied_home,
        "implied_odds_draw": implied_draw,
        "implied_odds_away": implied_away,
        "btts_prob": goal_grid_probability(
            goal_grid,
            lambda item: item.get("home_goals", 0) > 0 and item.get("away_goals", 0) > 0,
        ),
        "over_0_5_prob": over_0_5,
        "under_0_5_prob": under_0_5,
        "over_1_5_prob": over_1_5,
        "under_1_5_prob": under_1_5,
        "over_2_5_prob": over_2_5,
        "under_2_5_prob": under_2_5,
        "over_3_5_prob": over_3_5,
        "under_3_5_prob": under_3_5,
        "scoreline_probabilities": scoreline_probabilities,
        "h2h": details.get("h2h") if isinstance(details.get("h2h"), list) else [],
        "home_form": details.get("home_form") if isinstance(details.get("home_form"), list) else [],
        "away_form": details.get("away_form") if isinstance(details.get("away_form"), list) else [],
        "home_stats": (
            details.get("home_stats") if isinstance(details.get("home_stats"), dict) else {}
        ),
        "away_stats": (
            details.get("away_stats") if isinstance(details.get("away_stats"), dict) else {}
        ),
    }
    row.update(
        {
            f"score_{key.replace('-', '_')}_prob": value
            for key, value in scoreline_probabilities.items()
        }
    )
    return row


def date_window(start_date: date | None, days: int | None) -> tuple[date | None, date | None]:
    if start_date is None or days is None:
        return start_date, None
    return start_date, start_date + timedelta(days=max(days - 1, 0))


def fixture_in_window(
    fixture: dict[str, Any],
    start_date: date | None,
    end_date: date | None,
) -> bool:
    if start_date is None:
        return True
    fixture_date_raw = fixture.get("date")
    if not fixture_date_raw:
        return False
    fixture_date = parse_date(str(fixture_date_raw))
    if end_date is None:
        return fixture_date == start_date
    return start_date <= fixture_date <= end_date


def build_payload(
    *,
    competition_id: int,
    start_date: date | None,
    days: int | None,
    timeout_seconds: float,
) -> dict[str, Any]:
    window_start, window_end = date_window(start_date, days)
    with httpx.Client(base_url=API_BASE, timeout=timeout_seconds, follow_redirects=True) as client:
        fixtures_payload = fetch_json(client, f"/competitions/{competition_id}/fixtures")
        fixtures = (
            fixtures_payload.get("fixtures")
            if isinstance(fixtures_payload.get("fixtures"), list)
            else []
        )

        rows: list[dict[str, Any]] = []
        for fixture in fixtures:
            if not isinstance(fixture, dict) or not fixture_in_window(
                fixture,
                window_start,
                window_end,
            ):
                continue
            fixture_id = fixture.get("id")
            if fixture_id is None:
                continue
            details = fetch_json(
                client,
                f"/competitions/{competition_id}/fixtures/{fixture_id}/details",
            )
            rows.append(normalize_fixture(fixture, details))

    rows.sort(key=lambda row: (str(row.get("kickoff_at") or ""), str(row.get("fixture_id") or "")))
    return {
        "competition_id": competition_id,
        "generated_at": datetime.now(UTC).isoformat(),
        "window_start": window_start.isoformat() if window_start else None,
        "window_end": window_end.isoformat() if window_end else None,
        "count": len(rows),
        "fixtures": rows,
    }


def save_payload(payload: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def load_env_files() -> None:
    for env_path in (REPO_ROOT / "apps" / "api" / ".env", ROOT_DIR / ".env"):
        if not env_path.exists():
            continue
        for raw in env_path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def dec(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    return Decimal(str(value))


def pct_to_prob(value: Any) -> Decimal | None:
    value_decimal = dec(value)
    if value_decimal is None:
        return None
    return value_decimal / Decimal("100")


def american_to_prob(value: Any) -> Decimal | None:
    odd = dec(value)
    if odd is None:
        return None
    if odd >= Decimal("100"):
        return Decimal("100") / (odd + Decimal("100"))
    if odd <= Decimal("-100"):
        absolute = abs(odd)
        return absolute / (absolute + Decimal("100"))
    if odd > Decimal("1"):
        return Decimal("1") / odd
    return None


def fair_decimal(probability: Decimal | None) -> Decimal | None:
    if probability is None or probability <= 0:
        return None
    return Decimal("1") / probability


def model_total_probability(row: dict[str, Any], line_value: Decimal, selection: str) -> Decimal | None:
    line_key = format(line_value.normalize(), "f").replace(".", "_")
    over_probability = pct_to_prob(row.get(f"over_{line_key}_prob"))
    if over_probability is None:
        return None
    if selection == "over":
        return over_probability
    return Decimal("1") - over_probability


def recommendation_label(edge: Decimal | None) -> tuple[str, str]:
    if edge is None:
        return "model_only", "model_only"
    if edge >= Decimal("0.08"):
        return "paper_value", "high"
    if edge >= Decimal("0.04"):
        return "paper_value", "medium"
    if edge > 0:
        return "paper_watch", "low"
    return "no_value", "avoid"


def ensure_value_tables(conn: Any) -> None:
    migration_path = REPO_ROOT / "database" / "sql" / "010_quiniela_plus_value_lab.sql"
    if migration_path.exists():
        for statement in migration_path.read_text().split(";"):
            statement = statement.strip()
            if statement:
                conn.execute(text(statement))


def latest_match_id(conn: Any, fixture_id: str) -> str | None:
    return conn.execute(
        text("select id from public.matches where external_id = :fixture_id limit 1"),
        {"fixture_id": fixture_id},
    ).scalar()


def team_code_lookup(conn: Any) -> tuple[dict[str, str], set[str]]:
    lookup = {normalize_text(alias): code for alias, code in TEAM_CODE_ALIASES.items()}
    codes: set[str] = set()
    rows = conn.execute(text("select short_name, name, slug from public.teams")).mappings()
    for row in rows:
        code = str(row["short_name"] or "").upper()
        if not code:
            continue
        codes.add(code)
        for value in (row["short_name"], row["name"], row["slug"]):
            key = normalize_text(value)
            if key:
                lookup[key] = code
    return lookup, codes


def resolve_code(name: Any, lookup: dict[str, str], actual_codes: set[str]) -> str | None:
    code = lookup.get(normalize_text(str(name or "")))
    if code is None:
        return None
    for candidate in EQUIVALENT_TEAM_CODES.get(code, (code,)):
        if candidate in actual_codes:
            return candidate
    return code


def equivalent_codes(code: str | None) -> list[str]:
    if not code:
        return []
    return list(EQUIVALENT_TEAM_CODES.get(code, (code,)))


def latest_match_id_for_row(
    conn: Any,
    row: dict[str, Any],
    lookup: dict[str, str],
    actual_codes: set[str],
) -> str | None:
    fixture_match_id = latest_match_id(conn, str(row.get("fixture_id") or ""))
    if fixture_match_id:
        return fixture_match_id

    home_code = resolve_code(row.get("home"), lookup, actual_codes)
    away_code = resolve_code(row.get("away"), lookup, actual_codes)
    match_date = row.get("date")
    if not home_code or not away_code or not match_date:
        return None
    return conn.execute(
        text(
            """
            select m.id
            from public.matches m
            join public.teams ht on ht.id = m.home_team_id
            join public.teams at on at.id = m.away_team_id
            where ht.short_name = any(:home_codes)
              and at.short_name = any(:away_codes)
              and date(m.kickoff_at at time zone 'America/Mexico_City') = cast(:match_date as date)
            order by m.kickoff_at desc
            limit 1
            """
        ),
        {
            "home_codes": equivalent_codes(home_code),
            "away_codes": equivalent_codes(away_code),
            "match_date": str(match_date),
        },
    ).scalar()


def latest_odds(conn: Any, match_id: str | None) -> dict[str, Any] | None:
    if not match_id:
        return None
    row = conn.execute(
        text(
            """
            select home_value, draw_value, away_value, total_line, over_value, under_value, provider_name
            from public.odds
            where match_id = :match_id
            order by synced_at desc
            limit 1
            """
        ),
        {"match_id": match_id},
    ).mappings().first()
    return dict(row) if row else None


def insert_recommendation(
    conn: Any,
    *,
    snapshot_id: str,
    stats_match_id: str,
    match_id: str | None,
    fixture_id: str,
    market_key: str,
    selection_key: str,
    line_value: Any,
    model_probability: Decimal | None,
    market_probability: Decimal | None,
    market_odds: Any,
    reason: str,
) -> None:
    edge = (
        model_probability - market_probability
        if model_probability is not None and market_probability is not None
        else None
    )
    recommendation, confidence = recommendation_label(edge)
    conn.execute(
        text(
            """
            insert into public.quiniela_plus_value_recommendations (
              snapshot_id, stats_match_id, match_id, fixture_id, market_key, selection_key,
              line_value, model_probability, market_probability, market_odds, fair_odds_decimal,
              edge_probability, confidence_label, recommendation, reason, payload_json
            ) values (
              :snapshot_id, :stats_match_id, :match_id, :fixture_id, :market_key, :selection_key,
              :line_value, :model_probability, :market_probability, :market_odds, :fair_odds_decimal,
              :edge_probability, :confidence_label, :recommendation, :reason,
              cast(:payload_json as jsonb)
            )
            """
        ),
        {
            "snapshot_id": snapshot_id,
            "stats_match_id": stats_match_id,
            "match_id": match_id,
            "fixture_id": fixture_id,
            "market_key": market_key,
            "selection_key": selection_key,
            "line_value": dec(line_value),
            "model_probability": model_probability,
            "market_probability": market_probability,
            "market_odds": dec(market_odds),
            "fair_odds_decimal": fair_decimal(model_probability),
            "edge_probability": edge,
            "confidence_label": confidence,
            "recommendation": recommendation,
            "reason": reason,
            "payload_json": json.dumps(
                {
                    "edge": float(edge) if edge is not None else None,
                    "model_probability": float(model_probability) if model_probability is not None else None,
                    "market_probability": float(market_probability) if market_probability is not None else None,
                }
            ),
        },
    )


def save_payload_to_db(payload: dict[str, Any]) -> tuple[str, int, int]:
    load_env_files()
    from app.core.database import engine

    with engine.begin() as conn:
        ensure_value_tables(conn)
        lookup, actual_codes = team_code_lookup(conn)
        snapshot_id = conn.execute(
            text(
                """
                insert into public.quiniela_plus_stats_snapshots (
                  source_name, competition_id, generated_at, window_start, window_end, fixture_count, payload_json
                ) values (
                  'football_md', :competition_id, :generated_at, :window_start, :window_end,
                  :fixture_count, cast(:payload_json as jsonb)
                )
                returning id
                """
            ),
            {
                "competition_id": str(payload.get("competition_id") or ""),
                "generated_at": parse_dt(payload.get("generated_at")),
                "window_start": parse_date(payload["window_start"]) if payload.get("window_start") else None,
                "window_end": parse_date(payload["window_end"]) if payload.get("window_end") else None,
                "fixture_count": int(payload.get("count") or 0),
                "payload_json": json.dumps(
                    {
                        "competition_id": payload.get("competition_id"),
                        "generated_at": payload.get("generated_at"),
                        "window_start": payload.get("window_start"),
                        "window_end": payload.get("window_end"),
                    }
                ),
            },
        ).scalar_one()

        matches_saved = 0
        recommendations_saved = 0
        for row in payload.get("fixtures", []):
            if not isinstance(row, dict):
                continue
            fixture_id = str(row.get("fixture_id") or "")
            if not fixture_id:
                continue
            match_id = latest_match_id_for_row(conn, row, lookup, actual_codes)
            stats_match_id = conn.execute(
                text(
                    """
                    insert into public.quiniela_plus_stats_matches (
                      snapshot_id, match_id, fixture_id, match_date, kickoff_at, round_label, group_label,
                      home_name, away_name, home_win_prob, draw_prob, away_win_prob, xg_home, xg_away,
                      most_likely_score, most_likely_score_prob, btts_prob, over_1_5_prob,
                      over_2_5_prob, over_3_5_prob, scoreline_probabilities, payload_json
                    ) values (
                      :snapshot_id, :match_id, :fixture_id, :match_date, :kickoff_at, :round_label, :group_label,
                      :home_name, :away_name, :home_win_prob, :draw_prob, :away_win_prob, :xg_home, :xg_away,
                      :most_likely_score, :most_likely_score_prob, :btts_prob, :over_1_5_prob,
                      :over_2_5_prob, :over_3_5_prob, cast(:scoreline_probabilities as jsonb), cast(:payload_json as jsonb)
                    )
                    returning id
                    """
                ),
                {
                    "snapshot_id": snapshot_id,
                    "match_id": match_id,
                    "fixture_id": fixture_id,
                    "match_date": parse_date(str(row["date"])) if row.get("date") else None,
                    "kickoff_at": parse_dt(row.get("kickoff_at")),
                    "round_label": row.get("round"),
                    "group_label": row.get("group"),
                    "home_name": row.get("home") or "",
                    "away_name": row.get("away") or "",
                    "home_win_prob": dec(row.get("home_win_prob")),
                    "draw_prob": dec(row.get("draw_prob")),
                    "away_win_prob": dec(row.get("away_win_prob")),
                    "xg_home": dec(row.get("xg_home")),
                    "xg_away": dec(row.get("xg_away")),
                    "most_likely_score": row.get("most_likely_score"),
                    "most_likely_score_prob": dec(row.get("most_likely_score_prob")),
                    "btts_prob": dec(row.get("btts_prob")),
                    "over_1_5_prob": dec(row.get("over_1_5_prob")),
                    "over_2_5_prob": dec(row.get("over_2_5_prob")),
                    "over_3_5_prob": dec(row.get("over_3_5_prob")),
                    "scoreline_probabilities": json.dumps(row.get("scoreline_probabilities") or {}),
                    "payload_json": json.dumps(row),
                },
            ).scalar_one()
            matches_saved += 1

            odds = latest_odds(conn, match_id)
            if odds:
                raw_h = american_to_prob(odds.get("home_value"))
                raw_d = american_to_prob(odds.get("draw_value"))
                raw_a = american_to_prob(odds.get("away_value"))
                raw_sum = sum(prob for prob in (raw_h, raw_d, raw_a) if prob is not None)
                if raw_h is not None and raw_d is not None and raw_a is not None and raw_sum > 0:
                    market_probs = {
                        "home": raw_h / raw_sum,
                        "draw": raw_d / raw_sum,
                        "away": raw_a / raw_sum,
                    }
                    for selection, model_key, odds_key in (
                        ("home", "home_win_prob", "home_value"),
                        ("draw", "draw_prob", "draw_value"),
                        ("away", "away_win_prob", "away_value"),
                    ):
                        insert_recommendation(
                            conn,
                            snapshot_id=snapshot_id,
                            stats_match_id=stats_match_id,
                            match_id=match_id,
                            fixture_id=fixture_id,
                            market_key="h2h",
                            selection_key=selection,
                            line_value=None,
                            model_probability=pct_to_prob(row.get(model_key)),
                            market_probability=market_probs[selection],
                            market_odds=odds.get(odds_key),
                            reason="Football-MD probability versus no-vig 1X2 market.",
                        )
                        recommendations_saved += 1

                total_line = dec(odds.get("total_line"))
                raw_over = american_to_prob(odds.get("over_value"))
                raw_under = american_to_prob(odds.get("under_value"))
                if total_line is not None and raw_over is not None and raw_under is not None:
                    raw_total = raw_over + raw_under
                    if raw_total > 0:
                        for selection, market_prob, odds_key in (
                            ("over", raw_over / raw_total, "over_value"),
                            ("under", raw_under / raw_total, "under_value"),
                        ):
                            model_probability = model_total_probability(row, total_line, selection)
                            if model_probability is None:
                                continue
                            insert_recommendation(
                                conn,
                                snapshot_id=snapshot_id,
                                stats_match_id=stats_match_id,
                                match_id=match_id,
                                fixture_id=fixture_id,
                                market_key="total",
                                selection_key=selection,
                                line_value=total_line,
                                model_probability=model_probability,
                                market_probability=market_prob,
                                market_odds=odds.get(odds_key),
                                reason="Football-MD total probability versus no-vig totals market.",
                            )
                            recommendations_saved += 1

            btts_probability = pct_to_prob(row.get("btts_prob"))
            if btts_probability is not None:
                insert_recommendation(
                    conn,
                    snapshot_id=snapshot_id,
                    stats_match_id=stats_match_id,
                    match_id=match_id,
                    fixture_id=fixture_id,
                    market_key="btts_model",
                    selection_key="yes" if btts_probability >= Decimal("0.5") else "no",
                    line_value=None,
                    model_probability=btts_probability if btts_probability >= Decimal("0.5") else Decimal("1") - btts_probability,
                    market_probability=None,
                    market_odds=None,
                    reason="Model-only BTTS lean; The Odds API rejected btts for this sport.",
                )
                recommendations_saved += 1

    return str(snapshot_id), matches_saved, recommendations_saved


def main() -> int:
    parser = argparse.ArgumentParser(description="Pull advanced stats for Quiniela +.")
    parser.add_argument("--competition-id", type=int, default=DEFAULT_COMPETITION_ID)
    parser.add_argument(
        "--date",
        type=parse_date,
        default=None,
        help="YYYY-MM-DD. Defaults to all fixtures.",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=None,
        help="Inclusive window length from --date.",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    parser.add_argument("--skip-db", action="store_true", help="Only write JSON; do not persist DB snapshots/recommendations.")
    args = parser.parse_args()

    payload = build_payload(
        competition_id=args.competition_id,
        start_date=args.date,
        days=args.days,
        timeout_seconds=args.timeout_seconds,
    )
    save_payload(payload, args.output)
    if not args.skip_db:
        snapshot_id, matches_saved, recommendations_saved = save_payload_to_db(payload)
        print(
            f"Saved DB snapshot {snapshot_id}: "
            f"{matches_saved} stats matches, {recommendations_saved} recommendations."
        )
    print(
        f"Saved {payload['count']} advanced stats fixtures to {args.output} "
        f"for competition {payload['competition_id']}."
    )
    if payload["fixtures"]:
        first = payload["fixtures"][0]
        print(
            f"Sample: {first['home']} vs {first['away']} | "
            f"xG {first['xg_home']}-{first['xg_away']} | "
            f"{first['home_win_prob']}/{first['draw_prob']}/{first['away_win_prob']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
