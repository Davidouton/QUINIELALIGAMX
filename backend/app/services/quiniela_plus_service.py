from calendar import monthrange
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    CommerceSettings,
    Payment,
    Profile,
    QuinielaPlusBillingPeriod,
    QuinielaPlusLeague,
    QuinielaPlusMembership,
    QuinielaPlusMembershipLeague,
    QuinielaPlusMembershipStatus,
    QuinielaPlusPlan,
)
from app.schemas.quiniela_plus import (
    QuinielaPlusAdminConsoleResponse,
    QuinielaPlusAdminSettingsOut,
    QuinielaPlusAdminSettingsUpdateRequest,
    QuinielaPlusCatalogResponse,
    QuinielaPlusLeagueOut,
    QuinielaPlusLeagueUpsertRequest,
    QuinielaPlusMembershipLeagueOut,
    QuinielaPlusMembershipOut,
    QuinielaPlusPlanOut,
    QuinielaPlusPlanUpsertRequest,
)


class QuinielaPlusService:
    def list_catalog(self, db: Session, profile: Profile) -> QuinielaPlusCatalogResponse:
        self._refresh_expired_memberships(db, profile.id)
        settings = self._get_or_create_settings(db)
        leagues = list(
            db.scalars(
                select(QuinielaPlusLeague)
                .where(QuinielaPlusLeague.is_active.is_(True))
                .order_by(QuinielaPlusLeague.sort_order.asc(), QuinielaPlusLeague.league_name.asc())
            )
        )
        plans = list(
            db.scalars(
                select(QuinielaPlusPlan)
                .where(QuinielaPlusPlan.is_active.is_(True))
                .order_by(QuinielaPlusPlan.sort_order.asc(), QuinielaPlusPlan.price_amount.asc())
            )
        )
        memberships = self._list_memberships(db, profile.id, only_active=True)
        return QuinielaPlusCatalogResponse(
            checkout_enabled=settings.quiniela_plus_checkout_enabled,
            checkout_message=settings.quiniela_plus_checkout_message,
            leagues=[self._to_league_out(row) for row in leagues],
            plans=[self._to_plan_out(row) for row in plans],
            active_memberships=memberships,
        )

    def get_admin_console(self, db: Session) -> QuinielaPlusAdminConsoleResponse:
        settings = self._get_or_create_settings(db)
        leagues = list(
            db.scalars(
                select(QuinielaPlusLeague).order_by(
                    QuinielaPlusLeague.sort_order.asc(),
                    QuinielaPlusLeague.league_name.asc(),
                )
            )
        )
        plans = list(
            db.scalars(
                select(QuinielaPlusPlan).order_by(
                    QuinielaPlusPlan.sort_order.asc(),
                    QuinielaPlusPlan.billing_period.asc(),
                    QuinielaPlusPlan.price_amount.asc(),
                )
            )
        )
        return QuinielaPlusAdminConsoleResponse(
            settings=self._to_settings_out(settings),
            leagues=[self._to_league_out(row) for row in leagues],
            plans=[self._to_plan_out(row) for row in plans],
        )

    def update_settings(
        self,
        db: Session,
        payload: QuinielaPlusAdminSettingsUpdateRequest,
    ) -> QuinielaPlusAdminSettingsOut:
        row = self._get_or_create_settings(db)
        row.quiniela_plus_checkout_enabled = payload.checkout_enabled
        row.quiniela_plus_checkout_message = self._normalize_optional_text(payload.checkout_message)
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_settings_out(row)

    def create_league(self, db: Session, payload: QuinielaPlusLeagueUpsertRequest) -> QuinielaPlusLeagueOut:
        normalized_slug = self._normalize_slug(payload.slug)
        existing = db.scalar(select(QuinielaPlusLeague).where(QuinielaPlusLeague.slug == normalized_slug))
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ya existe una liga con ese slug")
        row = QuinielaPlusLeague(
            sport_name=payload.sport_name.strip(),
            league_name=payload.league_name.strip(),
            slug=normalized_slug,
            is_active=payload.is_active,
            sort_order=payload.sort_order,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_league_out(row)

    def update_league(
        self,
        db: Session,
        league_id: str,
        payload: QuinielaPlusLeagueUpsertRequest,
    ) -> QuinielaPlusLeagueOut:
        row = db.get(QuinielaPlusLeague, league_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Liga de Quiniela + no encontrada")
        normalized_slug = self._normalize_slug(payload.slug)
        existing = db.scalar(
            select(QuinielaPlusLeague).where(
                QuinielaPlusLeague.slug == normalized_slug,
                QuinielaPlusLeague.id != league_id,
            )
        )
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ya existe otra liga con ese slug")
        row.sport_name = payload.sport_name.strip()
        row.league_name = payload.league_name.strip()
        row.slug = normalized_slug
        row.is_active = payload.is_active
        row.sort_order = payload.sort_order
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_league_out(row)

    def create_plan(
        self,
        db: Session,
        payload: QuinielaPlusPlanUpsertRequest,
        current_profile: Profile,
    ) -> QuinielaPlusPlanOut:
        self._ensure_plan_combo_available(db, payload)
        row = QuinielaPlusPlan(
            name=payload.name.strip(),
            billing_period=QuinielaPlusBillingPeriod(payload.billing_period),
            included_leagues_count=None if payload.includes_all_leagues else payload.included_leagues_count,
            includes_all_leagues=payload.includes_all_leagues,
            price_amount=Decimal(str(payload.price_amount)),
            currency=payload.currency.strip().lower(),
            is_active=payload.is_active,
            sort_order=payload.sort_order,
            created_by_profile_id=current_profile.id,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_plan_out(row)

    def update_plan(
        self,
        db: Session,
        plan_id: str,
        payload: QuinielaPlusPlanUpsertRequest,
    ) -> QuinielaPlusPlanOut:
        row = db.get(QuinielaPlusPlan, plan_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan de Quiniela + no encontrado")
        self._ensure_plan_combo_available(db, payload, exclude_plan_id=plan_id)
        row.name = payload.name.strip()
        row.billing_period = QuinielaPlusBillingPeriod(payload.billing_period)
        row.included_leagues_count = None if payload.includes_all_leagues else payload.included_leagues_count
        row.includes_all_leagues = payload.includes_all_leagues
        row.price_amount = Decimal(str(payload.price_amount))
        row.currency = payload.currency.strip().lower()
        row.is_active = payload.is_active
        row.sort_order = payload.sort_order
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_plan_out(row)

    def list_memberships(self, db: Session, profile: Profile) -> list[QuinielaPlusMembershipOut]:
        self._refresh_expired_memberships(db, profile.id)
        return self._list_memberships(db, profile.id, only_active=False)

    def validate_checkout(
        self,
        db: Session,
        profile: Profile,
        plan_id: str,
        selected_league_ids: list[str],
        *,
        require_checkout_enabled: bool = True,
    ) -> tuple[QuinielaPlusPlan, list[QuinielaPlusLeague], QuinielaPlusAdminSettingsOut]:
        self._refresh_expired_memberships(db, profile.id)
        settings = self._to_settings_out(self._get_or_create_settings(db))
        if require_checkout_enabled and not settings.checkout_enabled:
            detail = settings.checkout_message or "Quiniela + todavia no esta habilitada para cobro"
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

        plan = db.get(QuinielaPlusPlan, plan_id)
        if plan is None or not plan.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan de Quiniela + no disponible")

        active_memberships = self._list_membership_rows(db, profile.id, only_active=True)
        if active_memberships:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya tienes una membresia activa de Quiniela +",
            )

        leagues = self._resolve_checkout_leagues(db, plan, selected_league_ids)
        return plan, leagues, settings

    def apply_paid_membership(
        self,
        db: Session,
        *,
        payment: Payment,
        selected_league_ids: list[str],
    ) -> QuinielaPlusMembership:
        existing = db.scalar(
            select(QuinielaPlusMembership).where(QuinielaPlusMembership.source_payment_id == payment.id)
        )
        if existing is not None:
            return existing

        plan = db.get(QuinielaPlusPlan, payment.scope_id)
        if plan is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan de Quiniela + no encontrado")

        leagues = self._resolve_checkout_leagues(db, plan, selected_league_ids)
        starts_at = payment.paid_at or datetime.now(UTC)
        membership = QuinielaPlusMembership(
            profile_id=payment.profile_id,
            plan_id=plan.id,
            source_payment_id=payment.id,
            status=QuinielaPlusMembershipStatus.ACTIVE,
            starts_at=starts_at,
            ends_at=self._calculate_end_at(starts_at, plan.billing_period),
        )
        db.add(membership)
        db.flush()

        for league in leagues:
            db.add(
                QuinielaPlusMembershipLeague(
                    membership_id=membership.id,
                    league_id=league.id,
                )
            )
        db.add(membership)
        return membership

    def _resolve_checkout_leagues(
        self,
        db: Session,
        plan: QuinielaPlusPlan,
        selected_league_ids: list[str],
    ) -> list[QuinielaPlusLeague]:
        active_leagues = list(
            db.scalars(
                select(QuinielaPlusLeague)
                .where(QuinielaPlusLeague.is_active.is_(True))
                .order_by(QuinielaPlusLeague.sort_order.asc(), QuinielaPlusLeague.league_name.asc())
            )
        )
        if not active_leagues:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Primero activa al menos una liga en Quiniela +",
            )

        if plan.includes_all_leagues:
            return active_leagues

        normalized_ids = list(dict.fromkeys(selected_league_ids))
        required_count = plan.included_leagues_count or 0
        if len(normalized_ids) != required_count:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Debes seleccionar exactamente {required_count} ligas para este plan",
            )

        active_by_id = {league.id: league for league in active_leagues}
        missing_ids = [league_id for league_id in normalized_ids if league_id not in active_by_id]
        if missing_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La seleccion incluye ligas no disponibles en Quiniela +",
            )
        return [active_by_id[league_id] for league_id in normalized_ids]

    def _refresh_expired_memberships(self, db: Session, profile_id: str | None = None) -> None:
        now = datetime.now(UTC)
        query = select(QuinielaPlusMembership).where(
            QuinielaPlusMembership.status == QuinielaPlusMembershipStatus.ACTIVE,
            QuinielaPlusMembership.ends_at < now,
        )
        if profile_id is not None:
            query = query.where(QuinielaPlusMembership.profile_id == profile_id)
        rows = list(db.scalars(query))
        if not rows:
            return
        for row in rows:
            row.status = QuinielaPlusMembershipStatus.EXPIRED
            db.add(row)
        db.commit()

    def _list_memberships(
        self,
        db: Session,
        profile_id: str,
        *,
        only_active: bool,
    ) -> list[QuinielaPlusMembershipOut]:
        memberships = self._list_membership_rows(db, profile_id, only_active=only_active)
        if not memberships:
            return []

        plan_ids = {membership.plan_id for membership in memberships}
        plans = {
            row.id: row
            for row in db.scalars(select(QuinielaPlusPlan).where(QuinielaPlusPlan.id.in_(plan_ids)))
        }
        links = list(
            db.scalars(
                select(QuinielaPlusMembershipLeague).where(
                    QuinielaPlusMembershipLeague.membership_id.in_([row.id for row in memberships])
                )
            )
        )
        league_ids = {link.league_id for link in links}
        leagues_by_id = {
            row.id: row
            for row in db.scalars(select(QuinielaPlusLeague).where(QuinielaPlusLeague.id.in_(league_ids)))
        }
        leagues_by_membership: dict[str, list[QuinielaPlusMembershipLeagueOut]] = {}
        for link in links:
            league = leagues_by_id.get(link.league_id)
            if league is None:
                continue
            leagues_by_membership.setdefault(link.membership_id, []).append(
                QuinielaPlusMembershipLeagueOut(
                    id=league.id,
                    sport_name=league.sport_name,
                    league_name=league.league_name,
                    slug=league.slug,
                )
            )

        result: list[QuinielaPlusMembershipOut] = []
        for membership in memberships:
            plan = plans.get(membership.plan_id)
            if plan is None:
                continue
            membership_leagues = leagues_by_membership.get(membership.id, [])
            membership_leagues.sort(key=lambda league: (league.sport_name.lower(), league.league_name.lower()))
            result.append(
                QuinielaPlusMembershipOut(
                    id=membership.id,
                    status=membership.status.value,
                    starts_at=membership.starts_at,
                    ends_at=membership.ends_at,
                    created_at=membership.created_at,
                    plan=self._to_plan_out(plan),
                    leagues=membership_leagues,
                )
            )
        return result

    def _list_membership_rows(
        self,
        db: Session,
        profile_id: str,
        *,
        only_active: bool,
    ) -> list[QuinielaPlusMembership]:
        query = (
            select(QuinielaPlusMembership)
            .where(QuinielaPlusMembership.profile_id == profile_id)
            .order_by(QuinielaPlusMembership.ends_at.desc(), QuinielaPlusMembership.created_at.desc())
        )
        if only_active:
            query = query.where(QuinielaPlusMembership.status == QuinielaPlusMembershipStatus.ACTIVE)
        return list(db.scalars(query))

    def _ensure_plan_combo_available(
        self,
        db: Session,
        payload: QuinielaPlusPlanUpsertRequest,
        *,
        exclude_plan_id: str | None = None,
    ) -> None:
        rows = list(
            db.scalars(
                select(QuinielaPlusPlan).where(
                    QuinielaPlusPlan.billing_period == QuinielaPlusBillingPeriod(payload.billing_period)
                )
            )
        )
        for row in rows:
            if exclude_plan_id and row.id == exclude_plan_id:
                continue
            same_bundle = (
                row.includes_all_leagues == payload.includes_all_leagues
                and row.included_leagues_count == (
                    None if payload.includes_all_leagues else payload.included_leagues_count
                )
            )
            if same_bundle:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Ya existe un plan con ese periodo y bundle",
                )

    def _get_or_create_settings(self, db: Session) -> CommerceSettings:
        row = db.scalar(select(CommerceSettings).order_by(CommerceSettings.created_at.asc()))
        if row is not None:
            return row
        row = CommerceSettings(
            quiniela_plus_checkout_enabled=False,
            quiniela_plus_checkout_message=(
                "Quiniela + ya esta montada, pero el checkout sigue deshabilitado mientras se cierra el tema fiscal."
            ),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    def _calculate_end_at(
        self,
        starts_at: datetime,
        billing_period: QuinielaPlusBillingPeriod,
    ) -> datetime:
        if billing_period == QuinielaPlusBillingPeriod.WEEKLY:
            return starts_at + timedelta(days=7)
        months_to_add = {
            QuinielaPlusBillingPeriod.MONTHLY: 1,
            QuinielaPlusBillingPeriod.QUARTERLY: 3,
            QuinielaPlusBillingPeriod.SEMIANNUAL: 6,
            QuinielaPlusBillingPeriod.ANNUAL: 12,
        }[billing_period]
        return self._add_months(starts_at, months_to_add)

    def _add_months(self, value: datetime, months_to_add: int) -> datetime:
        month_index = value.month - 1 + months_to_add
        year = value.year + month_index // 12
        month = month_index % 12 + 1
        day = min(value.day, monthrange(year, month)[1])
        return value.replace(year=year, month=month, day=day)

    def _normalize_optional_text(self, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    def _normalize_slug(self, value: str) -> str:
        normalized = value.strip().lower().replace(" ", "-")
        if not normalized:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El slug no puede quedar vacio")
        return normalized

    def _to_settings_out(self, row: CommerceSettings) -> QuinielaPlusAdminSettingsOut:
        return QuinielaPlusAdminSettingsOut(
            checkout_enabled=row.quiniela_plus_checkout_enabled,
            checkout_message=row.quiniela_plus_checkout_message,
        )

    def _to_league_out(self, row: QuinielaPlusLeague) -> QuinielaPlusLeagueOut:
        return QuinielaPlusLeagueOut(
            id=row.id,
            sport_name=row.sport_name,
            league_name=row.league_name,
            slug=row.slug,
            is_active=row.is_active,
            sort_order=row.sort_order,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _to_plan_out(self, row: QuinielaPlusPlan) -> QuinielaPlusPlanOut:
        return QuinielaPlusPlanOut(
            id=row.id,
            name=row.name,
            billing_period=row.billing_period.value,
            included_leagues_count=row.included_leagues_count,
            includes_all_leagues=row.includes_all_leagues,
            price_amount=float(row.price_amount),
            currency=row.currency,
            is_active=row.is_active,
            sort_order=row.sort_order,
            created_by_profile_id=row.created_by_profile_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
