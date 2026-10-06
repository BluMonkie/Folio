import re
from typing import List, Set

# Regex matches unescaped [[target]] or [[target|display]]
# Negative lookbehind (?<!\\) ensures escaped \[[...]] is ignored
WIKILINK_REGEX = re.compile(r"(?<!\\)\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")

def extract_wikilink_targets(markdown_text: str) -> Set[str]:
    """
    Extracts all unique target page titles from wikilinks in markdown content.
    Example:
        'See [[Relational Model]] and [[SQL Basics|SQL]]'
        -> {'Relational Model', 'SQL Basics'}
    """
    if not markdown_text:
        return set()

    matches = WIKILINK_REGEX.findall(markdown_text)
    # Strip whitespace from matched titles and filter out empty strings
    return {match.strip() for match in matches if match.strip()}

def sync_page_backlinks(cursor, from_page_id: int, book_id: int, markdown_text: str) -> None:
    """
    Synchronizes outgoing backlinks for a page within the same book:
    1. Extracts target titles from markdown.
    2. Deletes existing outgoing backlinks for this page.
    3. Finds target page_ids matching titles (case-insensitively).
    4. Inserts new rows into Backlinks table.
    """
    target_titles = extract_wikilink_targets(markdown_text)

    # 1. Delete old outgoing backlinks from this page
    cursor.execute("DELETE FROM Backlinks WHERE page_id_from = %s;", (from_page_id,))

    if not target_titles:
        return

    # 2. Lookup target pages in the same book (case-insensitive)
    placeholders = ", ".join(["%s"] * len(target_titles))
    query = f"""
        SELECT page_id 
        FROM Page 
        WHERE book_id = %s 
          AND LOWER(title) IN ({placeholders});
    """
    params = [book_id] + [title.lower() for title in target_titles]
    cursor.execute(query, params)
    target_rows = cursor.fetchall()

    # 3. Insert resolved backlinks
    if target_rows:
        insert_query = """
            INSERT IGNORE INTO Backlinks (page_id_from, page_id_to)
            VALUES (%s, %s);
        """
        for row in target_rows:
            target_id = row["page_id"]
            # Avoid self-linking backlink row if author linked to same page
            if target_id != from_page_id:
                cursor.execute(insert_query, (from_page_id, target_id))
