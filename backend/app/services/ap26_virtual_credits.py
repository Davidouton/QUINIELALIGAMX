"""Apertura 2026 virtual-credit reconciliation, separate from commerce."""
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
import json
import os
import re

AP26_ID = "f8a77bf8-1e42-4ea2-ad48-cc34224496d5"
ENTRY_CENTS = 150_000
WEEKS = tuple(range(1, 18))
PARTICIPANTS = 72
COMMISSION_CENTS = 540_000
RESERVE_CENTS = 2_700_000
# Production recipients are private runtime configuration, not public source.
RECIPIENTS_ENV = "AP26_VIRTUAL_CREDIT_RECIPIENTS"
PODIUM = {
    1: (263, 3_340_200),
    2: (256, 1_699_400),
    3: (243, 820_400),
}


def load_recipient_digests() -> tuple[str, dict[int, str]]:
    raw = os.environ.get(RECIPIENTS_ENV)
    if not raw:
        raise ValueError("AP26 credit recipients are not configured")
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or set(data) != {"commission", "podium"}:
            raise ValueError
        podium = data["podium"]
        if not isinstance(podium, dict) or set(podium) != {"1", "2", "3"}:
            raise ValueError
        values = [data["commission"], *podium.values()]
        if any(not isinstance(v, str) or not re.fullmatch(r"[0-9a-f]{64}", v) for v in values):
            raise ValueError
        if len(set(podium.values())) != 3:
            raise ValueError
        return data["commission"], {int(rank): v for rank, v in podium.items()}
    except (TypeError, ValueError):
        raise ValueError("AP26 credit recipients have invalid configuration") from None


def profile_digest(profile_id: str) -> str:
    return sha256(profile_id.lower().encode("ascii")).hexdigest()


def credits(cents: int) -> str:
    return f"{Decimal(cents) / 100:.2f}"


def as_cents(value: Decimal | int) -> int:
    return int((Decimal(value) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def split_tiers(ranks: dict[str, int], prizes: tuple[int, int, int]) -> dict[str, int]:
    """Share occupied prize places with same-rank players, preserving cents."""
    groups = defaultdict(list)
    for participant_id, place in ranks.items():
        groups[place].append(participant_id)
    expected_place = 1
    awards = {}
    for place, group in sorted(groups.items()):
        if place != expected_place:
            raise ValueError("Noncompetition ranking in settled standings")
        expected_place += len(group)
        prize = sum(prizes[max(0, place - 1):min(3, place - 1 + len(group))]) if place <= 3 else 0
        share, remainder = divmod(prize, len(group))
        for i, participant_id in enumerate(sorted(group)):
            amount = share + (i < remainder)
            if amount:
                awards[participant_id] = amount
    return awards


def build_preview(
    season_slug: str,
    members: dict[str, str],
    weeks: list[dict],
    commission_pct: Decimal,
    weekly_prizes: tuple[Decimal, Decimal, Decimal],
    overall: list[tuple[int, str, int]],
) -> dict:
    if season_slug != "ap26":
        raise ValueError("Virtual credits are available exclusively for Apertura 2026")
    if len(members) != PARTICIPANTS:
        raise ValueError("Eligible membership does not match the approved AP26 close")
    gross = ENTRY_CENTS * len(members)
    if Decimal(commission_pct) != 5 or gross * 5 // 100 != COMMISSION_CENTS:
        raise ValueError("Commission differs from the approved AP26 close")
    prizes = tuple(as_cents(p) for p in weekly_prizes)
    if prizes != (60_000, 30_000, 10_000):
        raise ValueError("Weekly prizes differ from the approved AP26 close")

    commission_recipient, podium_digests = load_recipient_digests()
    commission_matches = [profile_id for profile_id in members if profile_digest(profile_id) == commission_recipient]
    if len(commission_matches) != 1:
        raise ValueError("Commission recipient does not resolve to one eligible member")
    commission_profile_id = commission_matches[0]
    if sorted(rank for rank, _, _ in overall) != sorted(PODIUM):
        raise ValueError("Regular-season podium is not unique and complete")
    final_by_profile = {}
    for rank, profile_id, points in overall:
        expected_points, award = PODIUM[rank]
        expected_id = podium_digests[rank]
        if profile_id not in members or profile_digest(profile_id) != expected_id or points != expected_points:
            raise ValueError("Regular-season podium differs from the approved AP26 close")
        final_by_profile[profile_id] = award

    if tuple(sorted(w["number"] for w in weeks)) != WEEKS:
        raise ValueError("Missing or duplicate AP26 matchdays")
    entries = defaultdict(list)
    for week in sorted(weeks, key=lambda w: w["number"]):
        number = week["number"]
        if week["games"] != 9 or week["official"] != 9 or week["status"] not in ("closed", "published") or not week["published"]:
            raise ValueError("Cannot show a final AP26 balance with an unsettled matchday")
        ranks = week["ranks"]
        if set(ranks) != set(members):
            raise ValueError("Weekly standings do not match the eligible AP26 members")
        for profile_id, amount in split_tiers(ranks, prizes).items():
            entries[profile_id].append({"week": number, "rank": ranks[profile_id], "credits": credits(amount), "cents": amount})

    total_weekly = total_final = total_commission = total_balance = total_due = total_in_favor = 0
    balances = {}
    for profile_id, name in members.items():
        if not name or not name.strip():
            raise ValueError("Eligible AP26 member has no display name")
        awards = entries.get(profile_id, [])
        weekly = sum(a["cents"] for a in awards)
        final = final_by_profile.get(profile_id, 0)
        commission = COMMISSION_CENTS if profile_id == commission_profile_id else 0
        balance = weekly + final + commission - ENTRY_CENTS
        due, in_favor = max(-balance, 0), max(balance, 0)
        total_weekly += weekly
        total_final += final
        total_commission += commission
        total_balance += balance
        total_due += due
        total_in_favor += in_favor
        balances[profile_id] = {
            "display_name": name,
            "entry_credits": credits(ENTRY_CENTS),
            "weekly_award_credits": credits(weekly),
            "final_award_credits": credits(final),
            "commission_credits": credits(commission),
            "balance_credits": credits(balance),
            "due_credits": credits(due),
            "in_favor_credits": credits(in_favor),
            "awards": [{k: v for k, v in a.items() if k != "cents"} for a in awards],
        }
    allocated = total_weekly + total_final + total_commission
    if total_weekly != 1_700_000 or total_final != 5_860_000 or total_commission != COMMISSION_CENTS:
        raise ValueError("Credit categories do not match the approved AP26 close")
    if gross - allocated != RESERVE_CENTS or total_balance != -RESERVE_CENTS:
        raise ValueError("AP26 credits do not reconcile to the separate Liguilla reserve")
    summary = {
        "season": "Apertura 2026",
        "unit": "créditos ficticios",
        "participants": len(members),
        "settled_weeks": list(WEEKS),
        "entry_credits": credits(gross),
        "weekly_award_credits": credits(total_weekly),
        "final_award_credits": credits(total_final),
        "commission_credits": credits(total_commission),
        "allocated_credits": credits(allocated),
        "reserve_credits": credits(RESERVE_CENTS),
        "balance_credits": credits(total_balance),
        "due_credits": credits(total_due),
        "in_favor_credits": credits(total_in_favor),
    }
    return {"summary": summary, "balances": balances}
