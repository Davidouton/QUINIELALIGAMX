import hashlib
import hmac
import json
from datetime import UTC, datetime
from decimal import Decimal, ROUND_HALF_UP
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.datetime import ensure_utc
from app.models.entities import (
    Matchday,
    MatchdayStatus,
    Payment,
    PaymentScopeType,
    PaymentStatus,
    PricingRule,
    Profile,
    QuinielaPlusPlan,
    Season,
    SeasonMembership,
    VipCompetition,
    VipMembership,
    VipMembershipStatus,
)
from app.schemas.payments import (
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    EffectivePricingResponse,
    PaymentOut,
    PricingRuleOut,
    PricingRuleUpsertRequest,
)
from app.services.quiniela_plus_service import QuinielaPlusService


class PaymentService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.quiniela_plus_service = QuinielaPlusService()

    def list_pricing_rules(self, db: Session) -> list[PricingRuleOut]:
        rows = list(
            db.scalars(
                select(PricingRule).order_by(
                    PricingRule.scope_type.asc(),
                    PricingRule.scope_id.asc(),
                    PricingRule.created_at.desc(),
                )
            )
        )
        return [self._to_pricing_rule_out(row) for row in rows]

    def create_pricing_rule(
        self,
        db: Session,
        payload: PricingRuleUpsertRequest,
        current_profile: Profile,
    ) -> PricingRuleOut:
        self._ensure_scope_exists(db, payload.scope_type, payload.scope_id)
        row = PricingRule(
            scope_type=PaymentScopeType(payload.scope_type),
            scope_id=payload.scope_id,
            label=payload.label.strip(),
            amount=Decimal(str(payload.amount)),
            currency=payload.currency.strip().lower(),
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            start_matchday_number=payload.start_matchday_number,
            end_matchday_number=payload.end_matchday_number,
            is_active=payload.is_active,
            created_by_profile_id=current_profile.id,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_pricing_rule_out(row)

    def update_pricing_rule(
        self,
        db: Session,
        pricing_rule_id: str,
        payload: PricingRuleUpsertRequest,
    ) -> PricingRuleOut:
        row = db.get(PricingRule, pricing_rule_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regla de precio no encontrada")
        self._ensure_scope_exists(db, payload.scope_type, payload.scope_id)
        row.scope_type = PaymentScopeType(payload.scope_type)
        row.scope_id = payload.scope_id
        row.label = payload.label.strip()
        row.amount = Decimal(str(payload.amount))
        row.currency = payload.currency.strip().lower()
        row.starts_at = payload.starts_at
        row.ends_at = payload.ends_at
        row.start_matchday_number = payload.start_matchday_number
        row.end_matchday_number = payload.end_matchday_number
        row.is_active = payload.is_active
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_pricing_rule_out(row)

    def get_effective_pricing(
        self,
        db: Session,
        scope_type: str,
        scope_id: str,
    ) -> EffectivePricingResponse:
        rule = self._resolve_effective_pricing_rule(db, scope_type, scope_id)
        return EffectivePricingResponse(
            scope_type=rule.scope_type.value,
            scope_id=rule.scope_id,
            label=rule.label,
            amount=float(rule.amount),
            currency=rule.currency,
            pricing_rule_id=rule.id,
        )

    def list_my_payments(self, db: Session, profile: Profile) -> list[PaymentOut]:
        rows = list(
            db.scalars(
                select(Payment)
                .where(Payment.profile_id == profile.id)
                .order_by(Payment.created_at.desc())
            )
        )
        return [self._to_payment_out(row) for row in rows]

    def create_checkout_session(
        self,
        db: Session,
        profile: Profile,
        payload: CheckoutSessionRequest,
    ) -> CheckoutSessionResponse:
        if not self.settings.stripe_secret_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe no esta configurado en este ambiente",
            )

        request_metadata: dict[str, object] = {
            "scope_type": payload.scope_type,
            "scope_id": payload.scope_id,
            "selected_league_ids": payload.selected_league_ids,
        }

        if payload.scope_type == PaymentScopeType.QUINIELA_PLUS.value:
            plan, selected_leagues, _ = self.quiniela_plus_service.validate_checkout(
                db,
                profile,
                payload.scope_id,
                payload.selected_league_ids,
            )
            label = plan.name
            amount = plan.price_amount
            currency = plan.currency
            description = f"Acceso Quiniela + {plan.name}"
            metadata_extra = {
                "selected_league_ids": ",".join(league.id for league in selected_leagues),
                "selected_league_slugs": ",".join(league.slug for league in selected_leagues),
            }
            request_metadata["selected_league_ids"] = [league.id for league in selected_leagues]
            scope: Season | VipCompetition | QuinielaPlusPlan = plan
            pricing_rule_id = None
        else:
            scope = self._load_scope_or_404(db, payload.scope_type, payload.scope_id)
            self._validate_checkout_allowed(db, profile, payload.scope_type, scope)
            rule = self._resolve_effective_pricing_rule(db, payload.scope_type, payload.scope_id)
            label = rule.label
            amount = rule.amount
            currency = rule.currency
            description = (
                f"Pago {scope.name}"
                if payload.scope_type == PaymentScopeType.SEASON.value
                else f"Acceso VIP {scope.name}"
            )
            metadata_extra = {}
            request_metadata["pricing_rule_id"] = rule.id
            pricing_rule_id = rule.id

        payment = Payment(
            profile_id=profile.id,
            scope_type=PaymentScopeType(payload.scope_type),
            scope_id=payload.scope_id,
            pricing_rule_id=pricing_rule_id,
            provider_name="stripe",
            amount=amount,
            currency=currency,
            status=PaymentStatus.PENDING_CHECKOUT,
            metadata_json=json.dumps({"checkout_request": request_metadata}, default=str),
        )
        db.add(payment)
        db.flush()

        session_data = self._create_stripe_checkout_session(
            payment=payment,
            profile=profile,
            scope_type=payload.scope_type,
            label=label,
            amount=amount,
            currency=currency,
            description=description,
            metadata_extra=metadata_extra,
        )
        payment.status = PaymentStatus.CHECKOUT_CREATED
        payment.stripe_checkout_session_id = session_data["id"]
        payment.stripe_customer_id = session_data.get("customer")
        payment.checkout_url = session_data["url"]
        payment.metadata_json = json.dumps(
            {
                "checkout_request": request_metadata,
                "stripe_session": session_data,
            },
            default=str,
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)

        return CheckoutSessionResponse(
            payment_id=payment.id,
            checkout_session_id=payment.stripe_checkout_session_id or "",
            checkout_url=payment.checkout_url or "",
            scope_type=payment.scope_type.value,
            scope_id=payment.scope_id,
            label=label,
            amount=float(payment.amount),
            currency=payment.currency,
            status=payment.status.value,
        )

    def handle_webhook(self, db: Session, payload: bytes, signature: str | None) -> str:
        event = self._verify_and_parse_webhook(payload, signature)
        event_type = event.get("type", "unknown")

        if event_type == "checkout.session.completed":
            session_payload = event.get("data", {}).get("object", {})
            self._mark_checkout_completed(db, session_payload, event)
        elif event_type == "checkout.session.expired":
            session_payload = event.get("data", {}).get("object", {})
            self._mark_checkout_expired(db, session_payload, event)
        elif event_type == "payment_intent.payment_failed":
            intent_payload = event.get("data", {}).get("object", {})
            self._mark_payment_failed(db, intent_payload, event)

        return event_type

    def _ensure_scope_exists(self, db: Session, scope_type: str, scope_id: str) -> None:
        self._load_scope_or_404(db, scope_type, scope_id)

    def _load_scope_or_404(self, db: Session, scope_type: str, scope_id: str) -> Season | VipCompetition | QuinielaPlusPlan:
        if scope_type == PaymentScopeType.SEASON.value:
            scope = db.get(Season, scope_id)
            if scope is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Temporada no encontrada")
            return scope
        if scope_type == PaymentScopeType.VIP.value:
            scope = db.get(VipCompetition, scope_id)
            if scope is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")
            return scope
        if scope_type == PaymentScopeType.QUINIELA_PLUS.value:
            scope = db.get(QuinielaPlusPlan, scope_id)
            if scope is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan de Quiniela + no encontrado")
            return scope
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scope_type invalido")

    def _resolve_effective_pricing_rule(self, db: Session, scope_type: str, scope_id: str) -> PricingRule:
        self._ensure_scope_exists(db, scope_type, scope_id)
        rows = list(
            db.scalars(
                select(PricingRule)
                .where(
                    PricingRule.scope_type == PaymentScopeType(scope_type),
                    PricingRule.scope_id == scope_id,
                    PricingRule.is_active.is_(True),
                )
            )
        )
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No hay una regla de precio activa para este producto",
            )

        current_matchday_number = self._resolve_current_matchday_number(db, scope_type, scope_id)
        now = datetime.now(UTC)
        applicable = [row for row in rows if self._rule_matches(row, now, current_matchday_number)]
        if not applicable:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No hay una regla de precio vigente para este momento",
            )

        applicable.sort(
            key=lambda row: (
                row.start_matchday_number or -1,
                int(ensure_utc(row.starts_at).timestamp()) if row.starts_at else -1,
                int(ensure_utc(row.created_at).timestamp()),
            ),
            reverse=True,
        )
        return applicable[0]

    def _resolve_current_matchday_number(self, db: Session, scope_type: str, scope_id: str) -> int | None:
        if scope_type == PaymentScopeType.SEASON.value:
            season_id = scope_id
        else:
            vip = db.get(VipCompetition, scope_id)
            season_id = vip.season_id if vip is not None else None

        if season_id is None:
            return None

        rows = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season_id)
                .order_by(Matchday.number.asc())
            )
        )
        if not rows:
            return None

        active = next((row for row in rows if row.status == MatchdayStatus.ACTIVE), None)
        if active is not None:
            return active.number

        published_like = [row for row in rows if row.status in {MatchdayStatus.PUBLISHED, MatchdayStatus.CLOSED}]
        if published_like:
            return max(row.number for row in published_like)

        return min(row.number for row in rows)

    def _rule_matches(self, row: PricingRule, now: datetime, current_matchday_number: int | None) -> bool:
        if row.starts_at and now < ensure_utc(row.starts_at):
            return False
        if row.ends_at and now > ensure_utc(row.ends_at):
            return False
        if row.start_matchday_number is not None:
            if current_matchday_number is None or current_matchday_number < row.start_matchday_number:
                return False
        if row.end_matchday_number is not None:
            if current_matchday_number is None or current_matchday_number > row.end_matchday_number:
                return False
        return True

    def _validate_checkout_allowed(
        self,
        db: Session,
        profile: Profile,
        scope_type: str,
        scope: Season | VipCompetition,
    ) -> None:
        if scope_type == PaymentScopeType.SEASON.value:
            assert isinstance(scope, Season)
            membership = db.scalar(
                select(SeasonMembership).where(
                    SeasonMembership.season_id == scope.id,
                    SeasonMembership.profile_id == profile.id,
                )
            )
            if membership is not None and membership.is_paid:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esta temporada ya esta pagada")
            if scope.participants_lock_at and datetime.now(UTC) >= ensure_utc(scope.participants_lock_at):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La ventana de pago para esta temporada ya cerro",
                )
            return

        assert isinstance(scope, VipCompetition)
        if not scope.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Esta VIP no esta activa")
        membership = db.scalar(
            select(VipMembership).where(
                VipMembership.vip_competition_id == scope.id,
                VipMembership.profile_id == profile.id,
            )
        )
        if membership is not None and membership.status == VipMembershipStatus.APPROVED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ya perteneces a esta VIP")

    def _create_stripe_checkout_session(
        self,
        *,
        payment: Payment,
        profile: Profile,
        scope_type: str,
        label: str,
        amount: Decimal,
        currency: str,
        description: str,
        metadata_extra: dict[str, str],
    ) -> dict:
        amount_cents = self._to_cents(amount)
        success_url = self._format_success_url()
        cancel_url = self.settings.stripe_cancel_url

        payload: list[tuple[str, str]] = [
            ("mode", "payment"),
            ("success_url", success_url),
            ("cancel_url", cancel_url),
            ("client_reference_id", payment.id),
            ("line_items[0][quantity]", "1"),
            ("line_items[0][price_data][currency]", currency.lower()),
            ("line_items[0][price_data][unit_amount]", str(amount_cents)),
            ("line_items[0][price_data][product_data][name]", label),
            ("line_items[0][price_data][product_data][description]", description),
            ("metadata[payment_id]", payment.id),
            ("metadata[profile_id]", profile.id),
            ("metadata[scope_type]", scope_type),
            ("metadata[scope_id]", payment.scope_id),
        ]
        if payment.pricing_rule_id:
            payload.append(("metadata[pricing_rule_id]", payment.pricing_rule_id))
        for key, value in metadata_extra.items():
            payload.append((f"metadata[{key}]", value))
        if profile.email:
            payload.append(("customer_email", profile.email))

        response = httpx.post(
            f"{self.settings.stripe_api_base_url.rstrip('/')}/checkout/sessions",
            headers={
                "Authorization": f"Bearer {self.settings.stripe_secret_key}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            content=urlencode(payload),
            timeout=20.0,
        )
        if response.status_code >= 400:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Stripe rechazo la sesion de checkout: {response.text}",
            )
        data = response.json()
        if "id" not in data or "url" not in data:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Stripe respondio sin session id o checkout url",
            )
        return data

    def _format_success_url(self) -> str:
        success_url = self.settings.stripe_success_url
        if "{CHECKOUT_SESSION_ID}" in success_url:
            return success_url
        separator = "&" if "?" in success_url else "?"
        return f"{success_url}{separator}session_id={{CHECKOUT_SESSION_ID}}"

    def _verify_and_parse_webhook(self, payload: bytes, signature: str | None) -> dict:
        if not self.settings.stripe_webhook_secret:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe webhook secret no esta configurado",
            )
        if not signature:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Falta Stripe-Signature")

        parts = dict(
            item.split("=", 1)
            for item in signature.split(",")
            if "=" in item
        )
        timestamp = parts.get("t")
        sent_signature = parts.get("v1")
        if not timestamp or not sent_signature:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stripe-Signature invalida")

        current_ts = int(datetime.now(UTC).timestamp())
        if abs(current_ts - int(timestamp)) > self.settings.stripe_webhook_tolerance_seconds:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook de Stripe fuera de tolerancia")

        signed_payload = f"{timestamp}.{payload.decode('utf-8')}"
        expected_signature = hmac.new(
            self.settings.stripe_webhook_secret.encode("utf-8"),
            signed_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected_signature, sent_signature):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Firma de Stripe invalida")

        return json.loads(payload.decode("utf-8"))

    def _mark_checkout_completed(self, db: Session, session_payload: dict, event: dict) -> None:
        session_id = session_payload.get("id")
        if not session_id:
            return

        payment = db.scalar(select(Payment).where(Payment.stripe_checkout_session_id == session_id))
        if payment is None:
            return
        if payment.status == PaymentStatus.PAID:
            return

        payment.status = PaymentStatus.PAID
        payment.stripe_payment_intent_id = session_payload.get("payment_intent")
        payment.stripe_customer_id = session_payload.get("customer")
        payment.paid_at = datetime.now(UTC)
        payment_metadata = self._payment_metadata_dict(payment)
        payment_metadata["last_webhook_event"] = event
        payment.metadata_json = json.dumps(payment_metadata, default=str)
        self._apply_paid_entitlement(db, payment, payment_metadata)
        db.add(payment)
        db.commit()

    def _mark_checkout_expired(self, db: Session, session_payload: dict, event: dict) -> None:
        session_id = session_payload.get("id")
        if not session_id:
            return
        payment = db.scalar(select(Payment).where(Payment.stripe_checkout_session_id == session_id))
        if payment is None or payment.status == PaymentStatus.PAID:
            return
        payment.status = PaymentStatus.EXPIRED
        payment_metadata = self._payment_metadata_dict(payment)
        payment_metadata["last_webhook_event"] = event
        payment.metadata_json = json.dumps(payment_metadata, default=str)
        db.add(payment)
        db.commit()

    def _mark_payment_failed(self, db: Session, intent_payload: dict, event: dict) -> None:
        intent_id = intent_payload.get("id")
        if not intent_id:
            return
        payment = db.scalar(select(Payment).where(Payment.stripe_payment_intent_id == intent_id))
        if payment is None or payment.status == PaymentStatus.PAID:
            return
        payment.status = PaymentStatus.FAILED
        payment_metadata = self._payment_metadata_dict(payment)
        payment_metadata["last_webhook_event"] = event
        payment.metadata_json = json.dumps(payment_metadata, default=str)
        db.add(payment)
        db.commit()

    def _apply_paid_entitlement(self, db: Session, payment: Payment, payment_metadata: dict[str, object]) -> None:
        now = datetime.now(UTC)
        if payment.scope_type == PaymentScopeType.QUINIELA_PLUS:
            checkout_request = payment_metadata.get("checkout_request", {})
            selected_league_ids = checkout_request.get("selected_league_ids", [])
            if not isinstance(selected_league_ids, list):
                selected_league_ids = []
            self.quiniela_plus_service.apply_paid_membership(
                db,
                payment=payment,
                selected_league_ids=[str(league_id) for league_id in selected_league_ids],
            )
            return

        if payment.scope_type == PaymentScopeType.SEASON:
            membership = db.scalar(
                select(SeasonMembership).where(
                    SeasonMembership.season_id == payment.scope_id,
                    SeasonMembership.profile_id == payment.profile_id,
                )
            )
            if membership is None:
                membership = SeasonMembership(
                    season_id=payment.scope_id,
                    profile_id=payment.profile_id,
                )
            membership.is_paid = True
            membership.is_active = True
            membership.activated_at = now
            db.add(membership)
            return

        membership = db.scalar(
            select(VipMembership).where(
                VipMembership.vip_competition_id == payment.scope_id,
                VipMembership.profile_id == payment.profile_id,
            )
        )
        if membership is None:
            membership = VipMembership(
                vip_competition_id=payment.scope_id,
                profile_id=payment.profile_id,
                status=VipMembershipStatus.APPROVED,
                requested_at=now,
            )
        membership.status = VipMembershipStatus.APPROVED
        membership.is_paid = True
        membership.decided_at = now
        membership.admin_note = "Pago confirmado via Stripe"
        db.add(membership)

    def _payment_metadata_dict(self, payment: Payment) -> dict[str, object]:
        if not payment.metadata_json:
            return {}
        try:
            parsed = json.loads(payment.metadata_json)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def _to_pricing_rule_out(self, row: PricingRule) -> PricingRuleOut:
        return PricingRuleOut(
            id=row.id,
            scope_type=row.scope_type.value,
            scope_id=row.scope_id,
            label=row.label,
            amount=float(row.amount),
            currency=row.currency,
            starts_at=row.starts_at,
            ends_at=row.ends_at,
            start_matchday_number=row.start_matchday_number,
            end_matchday_number=row.end_matchday_number,
            is_active=row.is_active,
            created_by_profile_id=row.created_by_profile_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _to_payment_out(self, row: Payment) -> PaymentOut:
        return PaymentOut(
            id=row.id,
            scope_type=row.scope_type.value,
            scope_id=row.scope_id,
            pricing_rule_id=row.pricing_rule_id,
            provider_name=row.provider_name,
            amount=float(row.amount),
            currency=row.currency,
            status=row.status.value,
            stripe_checkout_session_id=row.stripe_checkout_session_id,
            stripe_payment_intent_id=row.stripe_payment_intent_id,
            stripe_customer_id=row.stripe_customer_id,
            checkout_url=row.checkout_url,
            paid_at=row.paid_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _to_cents(self, amount: Decimal) -> int:
        normalized = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return int((normalized * 100).to_integral_value(rounding=ROUND_HALF_UP))
