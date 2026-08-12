"""
Secure parameterized query builder for HealthPoint IDR Platform.
Prevents SQL injection by using asyncpg's parameterized query interface.

All dynamic WHERE clauses MUST use this builder — never f-string SQL.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class QueryBuilder:
    """
    Builds parameterized PostgreSQL queries safely.

    Usage:
        qb = QueryBuilder("SELECT * FROM idr_cases")
        qb.where("status = $p", "open")
        qb.where("provider_id = $p", provider_id)
        qb.order_by("created_at DESC")
        qb.paginate(limit=20, offset=0)
        sql, params = qb.build()
        rows = await fetchall(sql, *params)
    """
    base_sql: str
    _conditions: list[str] = field(default_factory=list)
    _params: list[Any] = field(default_factory=list)
    _order: Optional[str] = None
    _limit: Optional[int] = None
    _offset: Optional[int] = None
    _group_by: Optional[str] = None

    def where(self, condition_template: str, *values: Any) -> "QueryBuilder":
        """
        Add a WHERE condition with parameterized values.
        Use $p as a placeholder for each value.

        Example:
            qb.where("status = $p", "open")
            qb.where("amount BETWEEN $p AND $p", 100, 500)
        """
        condition = condition_template
        for value in values:
            idx = len(self._params) + 1
            condition = condition.replace("$p", f"${idx}", 1)
            self._params.append(value)
        self._conditions.append(condition)
        return self

    def where_if(self, condition_template: str, value: Any) -> "QueryBuilder":
        """Add WHERE condition only if value is not None."""
        if value is not None:
            self.where(condition_template, value)
        return self

    def order_by(self, clause: str) -> "QueryBuilder":
        """
        Set ORDER BY clause.
        ONLY accepts whitelisted column names to prevent injection.
        """
        # Whitelist of allowed sort columns
        allowed_columns = {
            "created_at", "updated_at", "id", "status", "amount",
            "case_id", "provider_id", "patient_id", "submitted_at",
            "resolved_at", "payment_date", "name", "email",
        }
        allowed_directions = {"ASC", "DESC"}

        parts = clause.strip().split()
        if len(parts) >= 1:
            col = parts[0].lower()
            direction = parts[1].upper() if len(parts) > 1 else "ASC"
            if col not in allowed_columns or direction not in allowed_directions:
                raise ValueError(
                    f"Invalid ORDER BY clause: '{clause}'. "
                    f"Column must be one of {allowed_columns}, "
                    f"direction must be ASC or DESC."
                )
            self._order = f"{col} {direction}"
        return self

    def order_by_raw(self, clause: str) -> "QueryBuilder":
        """
        Set ORDER BY clause without whitelist validation.
        ONLY use for static, developer-controlled values — never user input.
        """
        self._order = clause
        return self

    def paginate(self, limit: int, offset: int = 0) -> "QueryBuilder":
        """Add LIMIT and OFFSET for pagination."""
        self._limit = max(1, min(limit, 1000))  # Cap at 1000 rows
        self._offset = max(0, offset)
        return self

    def group_by(self, clause: str) -> "QueryBuilder":
        """Set GROUP BY clause (static values only)."""
        self._group_by = clause
        return self

    def build(self) -> tuple[str, list[Any]]:
        """Build the final SQL and parameter list."""
        sql = self.base_sql

        if self._conditions:
            sql += " WHERE " + " AND ".join(self._conditions)

        if self._group_by:
            sql += f" GROUP BY {self._group_by}"

        if self._order:
            sql += f" ORDER BY {self._order}"

        if self._limit is not None:
            idx = len(self._params) + 1
            sql += f" LIMIT ${idx}"
            self._params.append(self._limit)

        if self._offset is not None:
            idx = len(self._params) + 1
            sql += f" OFFSET ${idx}"
            self._params.append(self._offset)

        return sql, self._params

    def count_build(self) -> tuple[str, list[Any]]:
        """Build a COUNT(*) version of the query (no ORDER BY/LIMIT/OFFSET)."""
        sql = f"SELECT COUNT(*) FROM ({self.base_sql}"
        params = list(self._params)

        if self._conditions:
            sql += " WHERE " + " AND ".join(self._conditions)

        sql += ") AS _count_query"
        return sql, params


def build_list_query(
    table: str,
    filters: dict[str, Any],
    allowed_filters: set[str],
    order_by: str = "created_at DESC",
    limit: int = 20,
    offset: int = 0,
) -> tuple[str, list[Any]]:
    """
    Convenience function for standard list queries with filtering.

    Args:
        table: Table name (static, not user-controlled)
        filters: Dict of {column: value} pairs
        allowed_filters: Set of allowed filter columns (whitelist)
        order_by: Sort clause (static)
        limit: Page size
        offset: Page offset

    Returns:
        (sql, params) tuple for use with asyncpg
    """
    qb = QueryBuilder(f"SELECT * FROM {table}")

    for col, val in filters.items():
        if col not in allowed_filters:
            raise ValueError(f"Filter column '{col}' is not allowed")
        if val is not None:
            qb.where(f"{col} = $p", val)

    qb.order_by_raw(order_by)
    qb.paginate(limit, offset)
    return qb.build()
