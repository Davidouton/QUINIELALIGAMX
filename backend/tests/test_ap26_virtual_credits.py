from decimal import Decimal as D
import json
import os
import unittest
from unittest.mock import patch

from app.services import ap26_virtual_credits as svc

PRIZES = (D(600), D(300), D(100))
MEMBERS = {f"p{i:02}": f"Persona {i}" for i in range(1, 73)}
OVERALL = [(1, "p01", 263), (2, "p02", 256), (3, "p03", 243)]
RECIPIENT = "p04"

def weeks_fixture():
    ranks = {member: rank for rank, member in enumerate(MEMBERS, 1)}
    weeks = [dict(number=n, games=9, official=9, status="closed", published=True, ranks=dict(ranks)) for n in range(1, 18)]
    weeks[0]["ranks"][RECIPIENT] = 3  # Third-place tie: 50 credits each.
    weeks[0]["status"] = "published"
    return weeks

def override_recipients():
    return patch.dict(os.environ, {svc.RECIPIENTS_ENV: json.dumps({
        "commission": svc.profile_digest(RECIPIENT),
        "podium": {str(rank): svc.profile_digest(member) for rank, member, _ in OVERALL},
    })})


class PreviewTest(unittest.TestCase):
    def test_week10_six_at_second_exact_conservation_and_order(self):
        ranks = {"top": 1, **{i: 2 for i in "fedcba"}}
        shares = svc.split_tiers(ranks, (60000, 30000, 10000))
        self.assertEqual(shares["top"], 60000)
        self.assertEqual(sum(shares[i] for i in "abcdef"), 40000)
        self.assertEqual([shares[i] for i in "abcdef"], [6667]*4 + [6666]*2)

    def test_commission_separate_signed_reconciliation_and_immutable_recipient(self):
        # Any lookalike name must not redirect someone else's commission.
        members = {**MEMBERS, "p05": MEMBERS[RECIPIENT], RECIPIENT: "Perfil renombrado"}
        with override_recipients():
            out = svc.build_preview("ap26", members, weeks_fixture(), D(5), PRIZES, OVERALL)
        commission = out["balances"][RECIPIENT]
        self.assertEqual([commission[k] for k in ("commission_credits", "weekly_award_credits", "final_award_credits", "balance_credits", "due_credits", "in_favor_credits")],
                         ["5400.00", "50.00", "0.00", "3950.00", "0.00", "3950.00"])
        self.assertEqual(out["balances"]["p05"]["balance_credits"], "-1500.00")
        self.assertEqual(out["balances"]["p05"]["commission_credits"], "0.00")
        self.assertEqual(out["balances"]["p01"]["final_award_credits"], "33402.00")
        self.assertEqual([out["summary"][k] for k in ("commission_credits", "weekly_award_credits", "final_award_credits", "allocated_credits", "balance_credits", "reserve_credits")],
                         ["5400.00", "17000.00", "58600.00", "81000.00", "-27000.00", "27000.00"])

    def test_incomplete_or_changed_inputs_cannot_be_shown_as_final(self):
        for field, value in (("official", 8), ("status", "active"), ("published", False), ("ranks", {})):
            w = weeks_fixture()
            w[12][field] = value
            with self.subTest(field=field), override_recipients(), self.assertRaises(ValueError):
                svc.build_preview("ap26", MEMBERS, w, D(5), PRIZES, OVERALL)
        with override_recipients(), self.assertRaisesRegex(ValueError, "Commission"):
            svc.build_preview("ap26", MEMBERS, weeks_fixture(), D(4), PRIZES, OVERALL)
        with override_recipients(), self.assertRaisesRegex(ValueError, "podium"):
            svc.build_preview("ap26", MEMBERS, weeks_fixture(), D(5), PRIZES, [(1, "p05", 263), *OVERALL[1:]])
        with override_recipients(), self.assertRaisesRegex(ValueError, "recipient"):
            svc.build_preview("ap26", {**{k: v for k,v in MEMBERS.items() if k != RECIPIENT}, "p90": "Otra"},
                              weeks_fixture(), D(5), PRIZES, OVERALL)

    def test_missing_or_duplicate_private_configuration_is_rejected(self):
        with patch.dict(os.environ, {svc.RECIPIENTS_ENV: ""}), self.assertRaisesRegex(ValueError, "not configured"):
            svc.build_preview("ap26", MEMBERS, weeks_fixture(), D(5), PRIZES, OVERALL)
        key = svc.profile_digest("p01")
        with patch.dict(os.environ, {svc.RECIPIENTS_ENV: json.dumps({
            "commission": key, "podium": {"1": key, "2": key, "3": key}
        })}), self.assertRaisesRegex(ValueError, "invalid configuration"):
            svc.build_preview("ap26", MEMBERS, weeks_fixture(), D(5), PRIZES, OVERALL)

    def test_wrong_season_rejected(self):
        with self.assertRaisesRegex(ValueError, "Apertura"):
            svc.build_preview("lap26", {}, [], D(5), PRIZES, [])
