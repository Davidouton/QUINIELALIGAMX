from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.entities import RulePage
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
        version_label="Beta 1.0",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/rules", response_model=RulePageOut)
def get_rules_page(
    db: Session = Depends(get_db),
) -> RulePageOut:
    row = get_or_create_main_rule_page(db)
    return RulePageOut.model_validate(row, from_attributes=True)
