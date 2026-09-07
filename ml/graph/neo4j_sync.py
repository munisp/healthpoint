"""Optional Neo4j export of the dispute/payment graph.

Honest scope: the GNN (ml.models.pytorch_models.DisputeGNN) trains directly
from rows in Postgres (providers, payers, disputes, determinations) and does
NOT require Neo4j. This module mirrors the graph into Neo4j ONLY when
NEO4J_URI is set, for interactive fraud-ring exploration (Cypher queries,
graph viz of shared TIN/address motifs).

Cypher MERGE batches are idempotent and safe to re-run nightly.

CLI:
    NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=... \
        python -m ml.graph.neo4j_sync
"""

from __future__ import annotations

import logging
import os
from typing import Optional

log = logging.getLogger("ml.graph.neo4j")
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

BATCH = 1000


def _driver():
    uri = os.environ.get("NEO4J_URI")
    if not uri:
        return None
    try:
        from neo4j import GraphDatabase
    except ImportError:
        log.warning("NEO4J_URI set but neo4j driver not installed")
        return None
    return GraphDatabase.driver(
        uri,
        auth=(os.environ.get("NEO4J_USER", "neo4j"),
              os.environ.get("NEO4J_PASSWORD", "password")))


def sync_graph(driver, providers, payers, disputes) -> None:
    """MERGE the dispute graph in batches.

    providers: [{"id","tin","address","specialty","in_ring"}]
    payers:    [{"id","name","archetype"}]
    disputes:  [{"id","provider_id","payer_id","qpa","offer","outcome"}]
    """
    with driver.session() as s:
        s.run("CREATE CONSTRAINT provider_id IF NOT EXISTS "
              "FOR (p:Provider) REQUIRE p.id IS UNIQUE")
        s.run("CREATE CONSTRAINT payer_id IF NOT EXISTS "
              "FOR (p:Payer) REQUIRE p.id IS UNIQUE")
        s.run("CREATE CONSTRAINT dispute_id IF NOT EXISTS "
              "FOR (d:Dispute) REQUIRE d.id IS UNIQUE")

        def batched(rows, stmt):
            for i in range(0, len(rows), BATCH):
                s.run(stmt, rows=rows[i:i + BATCH])

        batched(providers,
                "UNWIND $rows AS r MERGE (p:Provider {id: r.id}) "
                "SET p.tin=r.tin, p.address=r.address, "
                "p.specialty=r.specialty, p.in_ring=r.in_ring")
        batched(payers,
                "UNWIND $rows AS r MERGE (p:Payer {id: r.id}) "
                "SET p.name=r.name, p.archetype=r.archetype")
        batched(disputes,
                "UNWIND $rows AS r MERGE (d:Dispute {id: r.id}) "
                "SET d.qpa=r.qpa, d.offer=r.offer, d.outcome=r.outcome "
                "WITH d, r MATCH (p:Provider {id: r.provider_id}) "
                "MERGE (p)-[:SUBMITTED]->(d) "
                "WITH d, r MATCH (pay:Payer {id: r.payer_id}) "
                "MERGE (pay)-[:OPPOSED]->(d)")
        # Shared-identifier motif edges (fraud-ring exploration).
        s.run("MATCH (a:Provider),(b:Provider) "
              "WHERE a.id < b.id AND a.tin = b.tin "
              "MERGE (a)-[:SHARES_TIN]-(b)")
        s.run("MATCH (a:Provider),(b:Provider) "
              "WHERE a.id < b.id AND a.address = b.address "
              "MERGE (a)-[:SHARES_ADDRESS]-(b)")
    log.info("Neo4j sync complete: %d providers, %d payers, %d disputes",
             len(providers), len(payers), len(disputes))


def load_graph_from_postgres():
    """Read providers/payers/disputes for export (same source as GNN training)."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        log.warning("DATABASE_URL not set; nothing to export")
        return None
    import psycopg
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT id, tin, address, specialty FROM providers")
        providers = [{"id": r[0], "tin": r[1], "address": r[2],
                      "specialty": r[3], "in_ring": False}
                     for r in cur.fetchall()]
        cur.execute("SELECT id, name FROM payers")
        payers = [{"id": r[0], "name": r[1], "archetype": "unknown"}
                  for r in cur.fetchall()]
        cur.execute("SELECT id, provider_id, payer_id, qpa, provider_offer "
                    "FROM idr_disputes")
        disputes = [{"id": r[0], "provider_id": r[1], "payer_id": r[2],
                     "qpa": float(r[3] or 0), "offer": float(r[4] or 0),
                     "outcome": None} for r in cur.fetchall()]
    return providers, payers, disputes


def main() -> None:
    driver = _driver()
    if driver is None:
        log.info("Neo4j not configured (NEO4J_URI unset or driver missing); "
                 "skipping export. GNN training is unaffected (reads Postgres "
                 "directly).")
        return
    data = load_graph_from_postgres()
    if data is None:
        return
    sync_graph(driver, *data)
    driver.close()


if __name__ == "__main__":
    main()
