import re

def slugify(text: str) -> str:
    """
    Generate a URL- and filesystem-safe slug from text.
    - Converts to lowercase
    - Replaces spaces with hyphens
    - Strips non-alphanumeric characters (except hyphens and underscores)
    - Collapses repeated hyphens
    """
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"[-\s]+", "-", text).strip("-")
