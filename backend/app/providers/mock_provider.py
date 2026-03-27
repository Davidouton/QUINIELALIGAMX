from collections.abc import Sequence


class MockSportsDataProvider:
    name = "mock"

    def fetch_matches(self) -> Sequence[dict]:
        return []

    def fetch_results(self) -> Sequence[dict]:
        return []

    def fetch_results_for_dates(self, dates: Sequence[str]) -> Sequence[dict]:
        return []

    def fetch_odds(self) -> Sequence[dict]:
        return []
