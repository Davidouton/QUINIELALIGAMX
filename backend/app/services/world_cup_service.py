from collections import defaultdict
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from hashlib import sha256
from html import unescape
from re import sub
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    Match,
    MatchResult,
    MatchStageType,
    Matchday,
    Season,
    Team,
    TournamentFormat,
    WorldCupGroup,
    WorldCupGroupTeam,
)
from app.schemas.world_cup import (
    WorldCupAdminGroupOut,
    WorldCupAdminGroupTeamOut,
    WorldCupAdminGroupTeamsUpdateRequest,
    WorldCupAdminGroupUpsertRequest,
    WorldCupBoardOut,
    WorldCupBracketMatchOut,
    WorldCupGroupOut,
    WorldCupGroupStandingOut,
    WorldCupNewsArticleOut,
    WorldCupNewsFeedOut,
    WorldCupOfficialResultOut,
)

NEWS_CACHE_TTL = timedelta(minutes=10)
NEWS_FEED_LIMIT = 18
NEWS_REQUEST_TIMEOUT_SECONDS = 6
NEWS_USER_AGENT = "QuinielaMaestra/1.0 (+https://quinielamaestra.app)"
NEWS_FEED_QUERIES = {
    "all": '"Mundial 2026"',
    "official": '"Mundial 2026" site:fifa.com/es',
    "mexico": '"Mundial 2026" "México"',
}
NEWS_CATEGORY_LABELS = {
    "all": "Todo",
    "official": "Oficial FIFA",
    "mexico": "México",
}

_news_cache: dict[str, tuple[datetime, WorldCupNewsFeedOut]] = {}


class WorldCupService:
    def get_board(self, db: Session, season_id: str | None = None) -> WorldCupBoardOut:
        season = self._resolve_season(db, season_id)
        matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season.id)
                .order_by(Matchday.number.asc(), Matchday.starts_at.asc())
            )
        )
        if not matchdays:
            return WorldCupBoardOut(season_id=season.id, season_name=season.name)

        matchday_ids = [matchday.id for matchday in matchdays]
        matches = list(
            db.scalars(
                select(Match)
                .where(Match.matchday_id.in_(matchday_ids))
                .order_by(Match.kickoff_at.asc(), Match.created_at.asc())
            )
        )
        results_by_match_id = {
            row.match_id: row
            for row in db.scalars(select(MatchResult).where(MatchResult.match_id.in_([match.id for match in matches])))
        }
        team_ids = {
            team_id
            for match in matches
            for team_id in (match.home_team_id, match.away_team_id)
            if team_id is not None
        }
        defined_groups = list(
            db.scalars(
                select(WorldCupGroup)
                .where(WorldCupGroup.season_id == season.id)
                .order_by(WorldCupGroup.sort_order.asc(), WorldCupGroup.group_label.asc())
            )
        )
        defined_group_ids = [group.id for group in defined_groups]
        group_team_links = list(
            db.scalars(select(WorldCupGroupTeam).where(WorldCupGroupTeam.group_id.in_(defined_group_ids)))
        ) if defined_group_ids else []
        team_ids.update(link.team_id for link in group_team_links)
        teams_by_id = {
            team.id: team for team in db.scalars(select(Team).where(Team.id.in_(team_ids)))
        } if team_ids else {}

        group_label_by_team_id = self._group_label_by_team_id(defined_groups, group_team_links)
        groups = self._build_groups(
            matches,
            results_by_match_id,
            teams_by_id,
            defined_groups,
            group_team_links,
            group_label_by_team_id,
        )
        bracket = self._build_bracket(matches, results_by_match_id, teams_by_id)
        official_results = self._build_official_results(
            matches,
            matchdays,
            results_by_match_id,
            teams_by_id,
            group_label_by_team_id,
        )
        return WorldCupBoardOut(
            season_id=season.id,
            season_name=season.name,
            groups=groups,
            official_results=official_results,
            round_of_32=bracket[MatchStageType.ROUND_OF_32],
            round_of_16=bracket[MatchStageType.ROUND_OF_16],
            quarterfinals=bracket[MatchStageType.QUARTERFINAL],
            semifinals=bracket[MatchStageType.SEMIFINAL],
            third_place=bracket[MatchStageType.THIRD_PLACE],
            final=bracket[MatchStageType.FINAL],
        )

    def _build_groups(
        self,
        matches: list[Match],
        results_by_match_id: dict[str, MatchResult],
        teams_by_id: dict[str, Team],
        defined_groups: list[WorldCupGroup],
        group_team_links: list[WorldCupGroupTeam],
        group_label_by_team_id: dict[str, str],
    ) -> list[WorldCupGroupOut]:
        group_matches: list[tuple[Match, str]] = []
        for match in matches:
            if (
                match.stage_type != MatchStageType.GROUP
                or match.home_team_id is None
                or match.away_team_id is None
            ):
                continue
            group_label = self._effective_group_label(match, group_label_by_team_id)
            if group_label:
                group_matches.append((match, group_label))
        groups: dict[str, dict[str, dict[str, int | str | None]]] = defaultdict(dict)
        group_ids_by_label = {group.id: group.group_label for group in defined_groups}

        for group in defined_groups:
            groups.setdefault(group.group_label, {})

        for link in sorted(group_team_links, key=lambda row: (group_ids_by_label.get(row.group_id, ""), row.sort_order, row.created_at)):
            group_label = group_ids_by_label.get(link.group_id)
            if not group_label:
                continue
            team = teams_by_id.get(link.team_id)
            groups[group_label].setdefault(
                link.team_id,
                {
                    "team_id": link.team_id,
                    "team_name": team.name if team is not None else "Equipo",
                    "team_short_name": team.short_name if team is not None else "EQ",
                    "team_crest_url": team.crest_url if team is not None else None,
                    "played": 0,
                    "wins": 0,
                    "draws": 0,
                    "losses": 0,
                    "goals_for": 0,
                    "goals_against": 0,
                    "goal_difference": 0,
                    "points": 0,
                },
            )

        for match, group_label in group_matches:
            for team_id in [match.home_team_id, match.away_team_id]:
                team = teams_by_id.get(team_id)
                groups[group_label].setdefault(
                    team_id,
                    {
                        "team_id": team_id,
                        "team_name": team.name if team is not None else "Equipo",
                        "team_short_name": team.short_name if team is not None else "EQ",
                        "team_crest_url": team.crest_url if team is not None else None,
                        "played": 0,
                        "wins": 0,
                        "draws": 0,
                        "losses": 0,
                        "goals_for": 0,
                        "goals_against": 0,
                        "goal_difference": 0,
                        "points": 0,
                    },
                )

            result = results_by_match_id.get(match.id)
            if result is None or not result.is_official:
                continue

            home_row = groups[group_label][match.home_team_id]
            away_row = groups[group_label][match.away_team_id]
            home_row["played"] += 1
            away_row["played"] += 1
            home_row["goals_for"] += result.home_score
            home_row["goals_against"] += result.away_score
            away_row["goals_for"] += result.away_score
            away_row["goals_against"] += result.home_score

            if result.home_score > result.away_score:
                home_row["wins"] += 1
                home_row["points"] += 3
                away_row["losses"] += 1
            elif result.away_score > result.home_score:
                away_row["wins"] += 1
                away_row["points"] += 3
                home_row["losses"] += 1
            else:
                home_row["draws"] += 1
                away_row["draws"] += 1
                home_row["points"] += 1
                away_row["points"] += 1

            home_row["goal_difference"] = home_row["goals_for"] - home_row["goals_against"]
            away_row["goal_difference"] = away_row["goals_for"] - away_row["goals_against"]

        result_groups: list[WorldCupGroupOut] = []
        for group_label, team_map in sorted(groups.items(), key=lambda item: item[0]):
            standings = [
                WorldCupGroupStandingOut(**team_row)
                for team_row in team_map.values()
            ]
            standings.sort(
                key=lambda row: (-row.points, -row.goal_difference, -row.goals_for, row.team_name.lower())
            )
            result_groups.append(WorldCupGroupOut(group_label=group_label, standings=standings))
        return result_groups

    def _build_bracket(
        self,
        matches: list[Match],
        results_by_match_id: dict[str, MatchResult],
        teams_by_id: dict[str, Team],
    ) -> dict[MatchStageType, list[WorldCupBracketMatchOut]]:
        bracket: dict[MatchStageType, list[WorldCupBracketMatchOut]] = {
            MatchStageType.ROUND_OF_32: [],
            MatchStageType.ROUND_OF_16: [],
            MatchStageType.QUARTERFINAL: [],
            MatchStageType.SEMIFINAL: [],
            MatchStageType.THIRD_PLACE: [],
            MatchStageType.FINAL: [],
        }
        for match in matches:
            if match.stage_type not in bracket:
                continue
            result = results_by_match_id.get(match.id)
            home_team = teams_by_id.get(match.home_team_id) if match.home_team_id else None
            away_team = teams_by_id.get(match.away_team_id) if match.away_team_id else None
            bracket[match.stage_type].append(
                WorldCupBracketMatchOut(
                    match_id=match.id,
                    matchday_id=match.matchday_id,
                    stage_type=match.stage_type,
                    bracket_slot=match.bracket_slot,
                    home_team_id=match.home_team_id,
                    home_placeholder=match.home_placeholder,
                    home_team_name=self._participant_name(home_team, match.home_placeholder, "Local"),
                    home_team_short_name=self._participant_short_name(home_team, match.home_placeholder, "LOC"),
                    home_team_crest_url=home_team.crest_url if home_team is not None else None,
                    away_team_id=match.away_team_id,
                    away_placeholder=match.away_placeholder,
                    away_team_name=self._participant_name(away_team, match.away_placeholder, "Visitante"),
                    away_team_short_name=self._participant_short_name(away_team, match.away_placeholder, "VIS"),
                    away_team_crest_url=away_team.crest_url if away_team is not None else None,
                    kickoff_at=match.kickoff_at,
                    home_score=result.home_score if result is not None else None,
                    away_score=result.away_score if result is not None else None,
                    advancing_team_id=result.advancing_team_id if result is not None else None,
                    is_official=bool(result and result.is_official),
                    is_ready_for_picks=bool(match.home_team_id and match.away_team_id),
                )
            )
        for stage_matches in bracket.values():
            stage_matches.sort(key=lambda row: (row.kickoff_at, row.bracket_slot or "", row.home_team_name.lower()))
        return bracket

    def _build_official_results(
        self,
        matches: list[Match],
        matchdays: list[Matchday],
        results_by_match_id: dict[str, MatchResult],
        teams_by_id: dict[str, Team],
        group_label_by_team_id: dict[str, str],
    ) -> list[WorldCupOfficialResultOut]:
        matchdays_by_id = {matchday.id: matchday for matchday in matchdays}
        rows: list[WorldCupOfficialResultOut] = []
        for match in matches:
            result = results_by_match_id.get(match.id)
            if result is None or not result.is_official:
                continue
            matchday = matchdays_by_id.get(match.matchday_id)
            home_team = teams_by_id.get(match.home_team_id) if match.home_team_id else None
            away_team = teams_by_id.get(match.away_team_id) if match.away_team_id else None
            rows.append(
                WorldCupOfficialResultOut(
                    match_id=match.id,
                    matchday_id=match.matchday_id,
                    matchday_number=matchday.number if matchday is not None else 0,
                    matchday_name=matchday.name if matchday is not None else "Jornada",
                    stage_type=match.stage_type,
                    group_label=self._effective_group_label(match, group_label_by_team_id),
                    bracket_slot=match.bracket_slot,
                    home_team_id=match.home_team_id,
                    home_placeholder=match.home_placeholder,
                    home_team_name=self._participant_name(home_team, match.home_placeholder, "Local"),
                    home_team_short_name=self._participant_short_name(home_team, match.home_placeholder, "LOC"),
                    home_team_crest_url=home_team.crest_url if home_team is not None else None,
                    away_team_id=match.away_team_id,
                    away_placeholder=match.away_placeholder,
                    away_team_name=self._participant_name(away_team, match.away_placeholder, "Visitante"),
                    away_team_short_name=self._participant_short_name(away_team, match.away_placeholder, "VIS"),
                    away_team_crest_url=away_team.crest_url if away_team is not None else None,
                    kickoff_at=match.kickoff_at,
                    home_score=result.home_score,
                    away_score=result.away_score,
                    advancing_team_id=result.advancing_team_id,
                    is_official=True,
                )
            )
        rows.sort(
            key=lambda row: (
                row.matchday_number,
                row.kickoff_at,
                row.group_label or "",
                row.bracket_slot or "",
                row.home_team_name.lower(),
            )
        )
        return rows

    def _group_label_by_team_id(
        self,
        defined_groups: list[WorldCupGroup],
        group_team_links: list[WorldCupGroupTeam],
    ) -> dict[str, str]:
        group_labels_by_id = {group.id: group.group_label for group in defined_groups}
        result: dict[str, str] = {}
        for link in group_team_links:
            group_label = group_labels_by_id.get(link.group_id)
            if group_label:
                result[link.team_id] = group_label
        return result

    @staticmethod
    def _effective_group_label(match: Match, group_label_by_team_id: dict[str, str]) -> str | None:
        if match.group_label:
            return match.group_label
        if match.home_team_id is None or match.away_team_id is None:
            return None
        home_group = group_label_by_team_id.get(match.home_team_id)
        away_group = group_label_by_team_id.get(match.away_team_id)
        if home_group and home_group == away_group:
            return home_group
        return None

    def _resolve_season(self, db: Session, season_id: str | None) -> Season:
        query = select(Season).where(Season.tournament_format == TournamentFormat.WORLD_CUP)
        if season_id:
            query = query.where(Season.id == season_id)
        else:
            query = query.where(Season.is_active.is_(True))
        season = db.scalar(query.order_by(Season.is_active.desc(), Season.created_at.desc()))
        if season is not None:
            return season
        if season_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Temporada mundialista no encontrada")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No hay una temporada mundialista activa")

    def list_news(self, category: str = "all") -> WorldCupNewsFeedOut:
        normalized_category = category if category in NEWS_FEED_QUERIES else "all"
        cached_at, cached_feed = _news_cache.get(
            normalized_category,
            (datetime.min.replace(tzinfo=UTC), WorldCupNewsFeedOut(category=normalized_category)),
        )
        if datetime.now(UTC) - cached_at < NEWS_CACHE_TTL:
            return cached_feed

        feed_url = self._build_google_news_feed_url(NEWS_FEED_QUERIES[normalized_category])
        articles = self._fetch_news_articles(feed_url, normalized_category)
        feed = WorldCupNewsFeedOut(category=normalized_category, articles=articles[:NEWS_FEED_LIMIT])
        _news_cache[normalized_category] = (datetime.now(UTC), feed)
        return feed

    def _fetch_news_articles(self, feed_url: str, category: str) -> list[WorldCupNewsArticleOut]:
        request = Request(feed_url, headers={"User-Agent": NEWS_USER_AGENT})
        try:
            with urlopen(request, timeout=NEWS_REQUEST_TIMEOUT_SECONDS) as response:
                body = response.read()
        except (HTTPError, URLError, TimeoutError, OSError):
            return []

        try:
            root = ElementTree.fromstring(body)
        except ElementTree.ParseError:
            return []

        articles: list[WorldCupNewsArticleOut] = []
        seen: set[str] = set()
        for item in root.findall("./channel/item"):
            title = self._read_xml_text(item, "title")
            url = self._read_xml_text(item, "link")
            if not title or not url:
                continue
            fingerprint = self._normalize_news_fingerprint(title, url)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            source = self._read_xml_text(item, "source") or NEWS_CATEGORY_LABELS[category]
            published_at = self._parse_news_datetime(self._read_xml_text(item, "pubDate"))
            articles.append(
                WorldCupNewsArticleOut(
                    id=sha256(fingerprint.encode("utf-8")).hexdigest()[:16],
                    category=category,
                    source=source,
                    title=title,
                    summary=self._clean_news_summary(self._read_xml_text(item, "description")),
                    url=url,
                    published_at=published_at,
                )
            )

        articles.sort(key=lambda article: article.published_at or datetime.min.replace(tzinfo=UTC), reverse=True)
        return articles

    def _build_google_news_feed_url(self, query: str) -> str:
        encoded_query = quote(query)
        return (
            "https://news.google.com/rss/search?"
            f"q={encoded_query}&hl=es-419&gl=MX&ceid=MX:es-419"
        )

    def _read_xml_text(self, item: ElementTree.Element, tag_name: str) -> str | None:
        node = item.find(tag_name)
        if node is None or node.text is None:
            return None
        value = unescape(node.text).strip()
        return value or None

    def _clean_news_summary(self, value: str | None) -> str | None:
        if not value:
            return None
        cleaned = sub(r"<[^>]+>", " ", value)
        cleaned = sub(r"\s+", " ", unescape(cleaned)).strip()
        if not cleaned:
            return None
        return cleaned[:260]

    def _normalize_news_fingerprint(self, title: str, url: str) -> str:
        normalized_title = sub(r"\s+", " ", title).strip().lower()
        return f"{normalized_title}:{url.strip().lower()}"

    def _parse_news_datetime(self, value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)

    def _participant_name(self, team: Team | None, placeholder: str | None, fallback: str) -> str:
        if team is not None:
            return team.name
        if placeholder:
            return placeholder
        return fallback

    def _participant_short_name(self, team: Team | None, placeholder: str | None, fallback: str) -> str:
        if team is not None:
            return team.short_name
        if placeholder:
            return placeholder
        return fallback

    def list_admin_groups(self, db: Session, season_id: str) -> list[WorldCupAdminGroupOut]:
        season = self._resolve_season(db, season_id)
        groups = list(
            db.scalars(
                select(WorldCupGroup)
                .where(WorldCupGroup.season_id == season.id)
                .order_by(WorldCupGroup.sort_order.asc(), WorldCupGroup.group_label.asc())
            )
        )
        group_ids = [group.id for group in groups]
        links = list(
            db.scalars(select(WorldCupGroupTeam).where(WorldCupGroupTeam.group_id.in_(group_ids)))
        ) if group_ids else []
        team_ids = sorted({link.team_id for link in links})
        teams_by_id = {
            team.id: team
            for team in db.scalars(select(Team).where(Team.id.in_(team_ids)))
        } if team_ids else {}
        links_by_group: dict[str, list[WorldCupGroupTeam]] = defaultdict(list)
        for link in links:
            links_by_group[link.group_id].append(link)

        rows: list[WorldCupAdminGroupOut] = []
        for group in groups:
            members = []
            for link in sorted(links_by_group.get(group.id, []), key=lambda row: (row.sort_order, row.created_at)):
                team = teams_by_id.get(link.team_id)
                if team is None:
                    continue
                members.append(
                    WorldCupAdminGroupTeamOut(
                        team_id=team.id,
                        team_name=team.name,
                        team_short_name=team.short_name,
                        team_crest_url=team.crest_url,
                    )
                )
            rows.append(
                WorldCupAdminGroupOut(
                    id=group.id,
                    season_id=group.season_id,
                    group_label=group.group_label,
                    display_name=group.display_name,
                    sort_order=group.sort_order,
                    teams=members,
                )
            )
        return rows

    def create_admin_group(self, db: Session, payload: WorldCupAdminGroupUpsertRequest) -> WorldCupAdminGroupOut:
        season = self._resolve_season(db, payload.season_id)
        row = WorldCupGroup(
            season_id=season.id,
            group_label=payload.group_label.strip().upper(),
            display_name=(payload.display_name.strip() if payload.display_name else None),
            sort_order=payload.sort_order,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return next(group for group in self.list_admin_groups(db, season.id) if group.id == row.id)

    def update_admin_group(self, db: Session, group_id: str, payload: WorldCupAdminGroupUpsertRequest) -> WorldCupAdminGroupOut:
        row = db.get(WorldCupGroup, group_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grupo mundialista no encontrado")
        self._resolve_season(db, payload.season_id)
        row.season_id = payload.season_id
        row.group_label = payload.group_label.strip().upper()
        row.display_name = payload.display_name.strip() if payload.display_name else None
        row.sort_order = payload.sort_order
        db.add(row)
        db.commit()
        db.refresh(row)
        return next(group for group in self.list_admin_groups(db, row.season_id) if group.id == row.id)

    def delete_admin_group(self, db: Session, group_id: str) -> dict[str, str]:
        row = db.get(WorldCupGroup, group_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grupo mundialista no encontrado")
        db.delete(row)
        db.commit()
        return {"status": "deleted", "group_id": group_id}

    def update_admin_group_teams(
        self,
        db: Session,
        group_id: str,
        payload: WorldCupAdminGroupTeamsUpdateRequest,
    ) -> WorldCupAdminGroupOut:
        group = db.get(WorldCupGroup, group_id)
        if group is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grupo mundialista no encontrado")

        normalized_ids = list(dict.fromkeys(payload.team_ids))
        teams = list(db.scalars(select(Team).where(Team.id.in_(normalized_ids)))) if normalized_ids else []
        found_ids = {team.id for team in teams}
        missing_ids = [team_id for team_id in normalized_ids if team_id not in found_ids]
        if missing_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uno o mas equipos no existen")

        current_links = list(db.scalars(select(WorldCupGroupTeam).where(WorldCupGroupTeam.group_id == group.id)))
        for link in current_links:
            db.delete(link)
        db.flush()

        for index, team_id in enumerate(normalized_ids):
            db.add(WorldCupGroupTeam(group_id=group.id, team_id=team_id, sort_order=index + 1))
        db.commit()
        return next(row for row in self.list_admin_groups(db, group.season_id) if row.id == group.id)

    def list_admin_bracket_matches(self, db: Session, season_id: str) -> list[Match]:
        season = self._resolve_season(db, season_id)
        matchday_ids = list(
            db.scalars(select(Matchday.id).where(Matchday.season_id == season.id))
        )
        if not matchday_ids:
            return []
        return list(
            db.scalars(
                select(Match)
                .where(
                    Match.matchday_id.in_(matchday_ids),
                    Match.stage_type.in_(
                        [
                            MatchStageType.ROUND_OF_32,
                            MatchStageType.ROUND_OF_16,
                            MatchStageType.QUARTERFINAL,
                            MatchStageType.SEMIFINAL,
                            MatchStageType.THIRD_PLACE,
                            MatchStageType.FINAL,
                        ]
                    ),
                )
                .order_by(Match.stage_type.asc(), Match.kickoff_at.asc(), Match.bracket_slot.asc())
            )
        )
