from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import RulePage, Season
from app.schemas.rules import RulePageKind, RulePageOut

router = APIRouter()


def get_or_create_main_rule_page(db: Session, page_kind: RulePageKind = "regular") -> RulePage:
    main_slug = "main" if page_kind == "regular" else "main-survivor"
    row = db.scalar(select(RulePage).where(RulePage.slug == main_slug))
    if row is not None:
        return row

    title = "Reglamento" if page_kind == "regular" else "Reglamento Survivor"
    row = RulePage(
        slug=main_slug,
        page_kind=page_kind,
        title=title,
        content_markdown="",
        version_label="v 1.06",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def build_rule_page_out(db: Session, row: RulePage) -> RulePageOut:
    season = db.get(Season, row.season_id) if row.season_id else None
    return RulePageOut(
        id=row.id,
        slug=row.slug,
        season_id=row.season_id,
        season_name=season.name if season is not None else None,
        page_kind=row.page_kind,
        title=row.title,
        content_markdown=row.content_markdown,
        version_label=row.version_label,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def get_or_create_rule_page(
    db: Session,
    season_id: str | None = None,
    page_kind: RulePageKind = "regular",
) -> RulePage:
    main_row = get_or_create_main_rule_page(db, page_kind)
    if not season_id:
        return main_row

    season = db.get(Season, season_id)
    if season is None:
        return main_row

    if page_kind == "survivor" and not (season.tournament_format == "standard" or season.survivor_enabled):
        return main_row

    row = db.scalar(
        select(RulePage).where(
            RulePage.season_id == season.id,
            RulePage.page_kind == page_kind,
        )
    )
    if row is not None:
        return row

    season_regular_row = db.scalar(
        select(RulePage).where(
            RulePage.season_id == season.id,
            RulePage.page_kind == "regular",
        )
    )
    fallback_row = season_regular_row if page_kind == "survivor" and season_regular_row is not None else main_row
    title = (
        season.survivor_name or "Reglamento Survivor"
        if page_kind == "survivor"
        else fallback_row.title
    )
    row = RulePage(
        slug=f"season-{season.id}" if page_kind == "regular" else f"season-{season.id}-survivor",
        season_id=season.id,
        page_kind=page_kind,
        title=title,
        content_markdown=fallback_row.content_markdown,
        version_label=fallback_row.version_label,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/rules", response_model=RulePageOut)
def get_rules_page(
    season_id: str | None = Query(default=None),
    page_kind: RulePageKind = Query(default="regular"),
    db: Session = Depends(get_db),
) -> RulePageOut:
    row = get_or_create_rule_page(db, season_id, page_kind)
    return build_rule_page_out(db, row)
