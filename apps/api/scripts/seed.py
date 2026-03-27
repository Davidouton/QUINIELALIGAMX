from sqlalchemy import select

from app.core.security import hash_password
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.user import User


# Minimal seed script to have one user ready for /auth/login testing.
def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing = db.scalar(select(User).where(User.email == "admin@ligamx.local"))
        if existing:
            print("Seed already applied")
            return

        user = User(
            name="Admin",
            email="admin@ligamx.local",
            password_hash=hash_password("admin123"),
        )
        db.add(user)
        db.commit()
        print("Seed complete: admin@ligamx.local / admin123")
    finally:
        db.close()


if __name__ == "__main__":
    main()
