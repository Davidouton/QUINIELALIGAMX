#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

API_BASE = "https://api.football-md.com/api/v1"
DEFAULT_COMPETITION_ID = 205
DEFAULT_OUTPUT_PATH = Path("app/data/quiniela_plus_advanced_stats.json")


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
    args = parser.parse_args()

    payload = build_payload(
        competition_id=args.competition_id,
        start_date=args.date,
        days=args.days,
        timeout_seconds=args.timeout_seconds,
    )
    save_payload(payload, args.output)
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
