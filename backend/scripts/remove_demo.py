"""Delete the demo sample entries (source = "sample") once real data has been imported.

Set CMD_LOAD_DEMO_DATA=false on the server as well, so an emptied database is not re-seeded.

    python -m scripts.remove_demo
"""

import sys
from pathlib import Path

from sqlalchemy import delete

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.models import Material  # noqa: E402


def main() -> None:
    settings.load_demo_data = False
    init_db()
    with SessionLocal() as session:
        deleted = session.execute(delete(Material).where(Material.source == "sample")).rowcount
        session.commit()
    print(f"Deleted {deleted} demo entries")


if __name__ == "__main__":
    main()
