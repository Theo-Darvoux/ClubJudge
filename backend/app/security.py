from urllib.parse import urlsplit


def _normalize_origin(value: str) -> str:
    return value.rstrip("/").lower()


def origin_allowed(
    origin: str | None,
    *,
    host: str,
    scheme: str,
    allowed_origins: list[str],
) -> bool:
    """Validate browser Origin while still allowing non-browser clients.

    Browsers send Origin for unsafe fetches and WebSocket handshakes. CLI tools
    such as curl often omit it, so an absent Origin is intentionally accepted.
    """
    if not origin:
        return True
    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    normalized = _normalize_origin(origin)
    same_origin = _normalize_origin(f"{scheme}://{host}")
    configured = {_normalize_origin(item) for item in allowed_origins}
    return normalized == same_origin or normalized in configured
