from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import RulePage, Season
from app.schemas.rules import RulePageOut

router = APIRouter()


def get_or_create_main_rule_page(db: Session) -> RulePage:
    row = db.scalar(select(RulePage).where(RulePage.slug == "main"))
    if row is not None:
        return row

    row = RulePage(
        slug="main",
        title="Reglamento",
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
        title=row.title,
        content_markdown=row.content_markdown,
        version_label=row.version_label,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def get_or_create_rule_page(db: Session, season_id: str | None = None) -> RulePage:
    main_row = get_or_create_main_rule_page(db)
    if not season_id:
        return main_row

    season = db.get(Season, season_id)
    if season is None:
        return main_row

    row = db.scalar(select(RulePage).where(RulePage.season_id == season.id))
    if row is not None:
        return row

    row = RulePage(
        slug=f"season-{season.id}",
        season_id=season.id,
        title=main_row.title,
        content_markdown=main_row.content_markdown,
        version_label=main_row.version_label,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/rules", response_model=RulePageOut)
def get_rules_page(
    season_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> RulePageOut:
    row = get_or_create_rule_page(db, season_id)
    return build_rule_page_out(db, row)
