from collections.abc import Sequence
from typing import Protocol


class SportsDataProvider(Protocol):
    name: str

    def fetch_matches(self) -> Sequence[dict]:
        ...

    def fetch_results(self) -> Sequence[dict]:
        ...

    def fetch_results_for_dates(self, dates: Sequence[str]) -> Sequence[dict]:
        ...

    def fetch_odds(self) -> Sequence[dict]:
        ...
