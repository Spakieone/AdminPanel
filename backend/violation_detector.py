"""
Simplified multi-factor violation detector.
Based on connection batch data from node agents.

Analyzers:
- Temporal: simultaneous connections from multiple IPs
- Geo: impossible travel (multiple countries)
- ASN: VPN/datacenter/proxy usage
"""
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from violations_store import (
    create_violation,
    is_whitelisted,
    get_recent_connections,
)


@dataclass
class ViolationResult:
    total_score: float
    recommended_action: str
    confidence: float
    reasons: List[str]
    countries: List[str]
    ips: List[str]
    asn_types: List[str]
    temporal_score: float = 0
    geo_score: float = 0
    asn_score: float = 0
    profile_score: float = 0
    device_score: float = 0


def _recommended_action(score: float) -> str:
    if score < 30:
        return "no_action"
    if score < 50:
        return "monitor"
    if score < 65:
        return "warn"
    if score < 80:
        return "soft_block"
    if score < 90:
        return "temp_block"
    return "hard_block"


def _analyze_temporal(connections: List[Dict[str, Any]]) -> float:
    """
    Check for simultaneous connections from different IPs.
    connections: list of {ip_address, connected_at (float), disconnected_at (float|None)}
    """
    if len(connections) < 2:
        return 0.0

    # Group connections by 2-minute windows
    # Sort by connected_at
    sorted_conns = sorted(connections, key=lambda c: c.get("connected_at", 0))

    # Find overlapping connections (within 2 min window)
    simultaneous_ips: Set[str] = set()
    window = 120  # 2 minutes

    for i, c1 in enumerate(sorted_conns):
        t1 = c1.get("connected_at", 0)
        ip1 = c1.get("ip_address", "")
        for c2 in sorted_conns[i + 1:]:
            t2 = c2.get("connected_at", 0)
            if t2 - t1 > window:
                break
            ip2 = c2.get("ip_address", "")
            if ip1 != ip2:
                simultaneous_ips.add(ip1)
                simultaneous_ips.add(ip2)

    n = len(simultaneous_ips)
    if n == 0:
        return 0.0
    if n == 2:
        return 40.0
    if n == 3:
        return 70.0
    return min(100.0, 80.0 + (n - 3) * 5)


def _analyze_geo(connections: List[Dict[str, Any]], ip_meta: Dict[str, Dict]) -> tuple[float, List[str]]:
    """Check for impossible travel / multiple countries."""
    countries: Set[str] = set()
    for c in connections:
        ip = c.get("ip_address", "")
        meta = ip_meta.get(ip, {})
        country = meta.get("country")
        if country:
            countries.add(country)

    if len(countries) <= 1:
        return 0.0, list(countries)

    # Multiple countries = suspicious
    n = len(countries)
    score = min(100.0, (n - 1) * 25.0)
    return score, list(countries)


def _analyze_asn(connections: List[Dict[str, Any]], ip_meta: Dict[str, Dict]) -> tuple[float, List[str]]:
    """Check for VPN/proxy/datacenter connections."""
    asn_types: Set[str] = set()
    vpn_count = 0
    proxy_count = 0
    hosting_count = 0
    total = len(connections)

    for c in connections:
        ip = c.get("ip_address", "")
        meta = ip_meta.get(ip, {})
        if meta.get("is_vpn"):
            vpn_count += 1
            asn_types.add("vpn")
        if meta.get("is_proxy"):
            proxy_count += 1
            asn_types.add("proxy")
        if meta.get("is_hosting"):
            hosting_count += 1
            asn_types.add("hosting")

    if total == 0:
        return 0.0, []

    score = 0.0
    if vpn_count / total > 0.5:
        score += 20.0
    if proxy_count / total > 0.3:
        score += 30.0
    if hosting_count / total > 0.3:
        score += 25.0

    return min(score, 80.0), list(asn_types)


# Per-user cooldown: don't re-check same user within N seconds
_cooldown: Dict[str, float] = {}
COOLDOWN_SECONDS = 300  # 5 minutes


def analyze_user(
    db_path: Path,
    user_email: str,
    node_uuid: str,
    new_connections: List[Dict[str, Any]],
    ip_meta: Optional[Dict[str, Dict]] = None,
) -> Optional[ViolationResult]:
    """
    Run multi-analyzer detection for a user.
    Returns ViolationResult if score >= 30, else None.
    """
    # Cooldown check
    now = time.time()
    last = _cooldown.get(user_email, 0)
    if now - last < COOLDOWN_SECONDS:
        return None
    _cooldown[user_email] = now

    # Whitelist check
    if is_whitelisted(db_path, user_email):
        return None

    if ip_meta is None:
        ip_meta = {}

    # Recent connection history from DB
    history = get_recent_connections(db_path, user_email, hours=24)

    # Merge new + historical for analysis
    all_conns = history + new_connections

    if len(all_conns) < 2:
        return None

    # Run analyzers
    temporal = _analyze_temporal(all_conns)
    geo_score, countries = _analyze_geo(all_conns, ip_meta)
    asn_score, asn_types = _analyze_asn(all_conns, ip_meta)

    # Weighted total
    total = temporal * 0.40 + geo_score * 0.35 + asn_score * 0.25

    if total < 30:
        return None

    # Build reasons
    reasons = []
    if temporal >= 40:
        unique_ips = len({c.get("ip_address") for c in all_conns})
        reasons.append(f"Одновременные подключения с {unique_ips} IP-адресов")
    if geo_score >= 25:
        reasons.append(f"Подключения из {len(countries)} стран: {', '.join(countries)}")
    if asn_score >= 20:
        reasons.append(f"Использование: {', '.join(asn_types)}")

    all_ips = list({c.get("ip_address", "") for c in all_conns if c.get("ip_address")})

    return ViolationResult(
        total_score=round(total, 1),
        recommended_action=_recommended_action(total),
        confidence=min(1.0, total / 100),
        reasons=reasons,
        countries=countries,
        ips=all_ips[:20],
        asn_types=asn_types,
        temporal_score=round(temporal, 1),
        geo_score=round(geo_score, 1),
        asn_score=round(asn_score, 1),
    )


def process_batch(
    db_path: Path,
    node_uuid: str,
    connections: List[Dict[str, Any]],
    ip_meta: Optional[Dict[str, Dict]] = None,
) -> int:
    """
    Process a connection batch from a node agent.
    Groups connections by user_email and runs analysis.
    Returns count of violations created.
    """
    if not connections:
        return 0

    # Group by user
    by_user: Dict[str, List[Dict]] = {}
    for c in connections:
        email = c.get("user_email", "")
        if email:
            by_user.setdefault(email, []).append(c)

    violations_created = 0
    for email, user_conns in by_user.items():
        result = analyze_user(db_path, email, node_uuid, user_conns, ip_meta)
        if result:
            create_violation(
                db_path=db_path,
                user_email=email,
                node_uuid=node_uuid,
                score=result.total_score,
                recommended_action=result.recommended_action,
                confidence=result.confidence,
                reasons=result.reasons,
                countries=result.countries,
                ips=result.ips,
                asn_types=result.asn_types,
                temporal_score=result.temporal_score,
                geo_score=result.geo_score,
                asn_score=result.asn_score,
                profile_score=result.profile_score,
                device_score=result.device_score,
            )
            violations_created += 1

    return violations_created
