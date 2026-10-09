import html
import re
from typing import Dict, List, Optional
import mistune

from backend.database import get_db, get_runner_db
from backend.services.query_validator import validate_select_query

ESCAPED_FENCE_RE = r'(?P<esc_fence>\\+)(?P<esc_fence_body>`{3,}|~{3,})[ \t]*(?P<esc_fence_lang>[^\r\n`]*)\r?\n(?P<esc_fence_code>[\s\S]*?)\r?\n[ \t]*(?P=esc_fence_body)[ \t]*(?:\r?\n|$)'
FENCED_BLOCK_RE = r'^[ \t]*(?P<fence>`{3,}|~{3,})[ \t]*(?P<lang>[^\r\n`]*)\r?\n(?P<code>[\s\S]*?)\r?\n[ \t]*(?P=fence)[ \t]*(?:\r?\n|$)'
INLINE_CODE_RE = r'(?P<ticks>`+)(?P<inline>[\s\S]*?)(?P=ticks)'
ESCAPED_COLON_RE = r'(?P<esc_colon>\\+)(?P<esc_colon_body>:::+\s*query\b[\s\S]*?(?:\\:::+|:::+))'
ESCAPED_SINGLE_RE = r'(?P<esc_single>\\+)(?P<esc_single_body>:::+\s*query\b)'
COLON_QUERY_RE = r'(?P<colon_query>:::+\s*query\b(?P<colon_sql>[\s\S]*?):::+)'

QUERY_SCANNER_REGEX = re.compile(
    f'({ESCAPED_FENCE_RE})|({FENCED_BLOCK_RE})|({INLINE_CODE_RE})|({ESCAPED_COLON_RE})|({ESCAPED_SINGLE_RE})|({COLON_QUERY_RE})',
    re.MULTILINE | re.IGNORECASE
)

WIKILINK_SCANNER_REGEX = re.compile(
    r'(^[ \t]*(?:`{3,}|~{3,})[^\r\n`]*\r?\n[\s\S]*?\r?\n[ \t]*(?:`{3,}|~{3,})[ \t]*(?:\r?\n|$))'
    r'|(`+[\s\S]*?`+)'
    r'|(?P<esc_slashes>\\+)\[\[(?P<esc_target>[^\]|\\]+)(?:\|(?P<esc_label>[^\]\\]+))?\]\]'
    r'|\[\[(?P<wl_target>[^\]|\\]+)(?:\|(?P<wl_label>[^\]\\]+))?\]\]',
    re.MULTILINE
)

def render_error_block(title: str, message: str) -> str:
    """Renders a styled error container for SQL validation or execution failures."""
    escaped_title = html.escape(title)
    escaped_message = html.escape(message)
    return (
        f'<div class="folio-query-box folio-query-error">'
        f'  <div class="folio-query-header"><span class="folio-badge folio-badge-error">{escaped_title}</span></div>'
        f'  <div class="folio-query-body"><pre class="folio-error-text">{escaped_message}</pre></div>'
        f'</div>'
    )

def render_table_html(columns: List[str], rows: List[dict], total_count: int, truncated: bool) -> str:
    """Renders an HTML data table from query results."""
    if not rows:
        return (
            f'<div class="folio-query-box">'
            f'  <div class="folio-query-header">'
            f'    <span class="folio-count">0 rows</span>'
            f'  </div>'
            f'  <div class="folio-query-empty">No records found.</div>'
            f'</div>'
        )

    headers_html = "".join(f"<th>{html.escape(str(col))}</th>" for col in columns)
    
    rows_html_list = []
    for row in rows:
        cells = []
        for col in columns:
            val = row.get(col)
            val_str = "" if val is None else str(val)
            cells.append(f"<td>{html.escape(val_str)}</td>")
        rows_html_list.append(f"<tr>{''.join(cells)}</tr>")
    
    tbody_html = "".join(rows_html_list)
    count_label = f"{len(rows)} row(s)"
    if truncated:
        count_label += f" (truncated from {total_count})"

    return (
        f'<div class="folio-query-box">'
        f'  <div class="folio-query-header">'
        f'    <span class="folio-count">{count_label}</span>'
        f'  </div>'
        f'  <div class="folio-table-wrapper">'
        f'    <table class="folio-data-table">'
        f'      <thead><tr>{headers_html}</tr></thead>'
        f'      <tbody>{tbody_html}</tbody>'
        f'    </table>'
        f'  </div>'
        f'</div>'
    )

def execute_and_render_query(page_id: int, book_id: int, sql_text: str) -> str:
    """
    Executes a single query block through validation, grant verification,
    and sandboxed execution using the MySQL 8.0 role.
    """
    # 1. AST Validation
    is_valid, error_msg, physical_tables = validate_select_query(sql_text)
    if not is_valid:
        return render_error_block("Query Notice", error_msg or "Invalid query syntax.")

    # 2. Check Table Grants via Database View (v_EffectivePageGrants)
    with get_db() as cursor:
        cursor.execute("""
            SELECT LOWER(table_name) AS table_name 
            FROM v_EffectivePageGrants 
            WHERE page_id = %s AND can_read = TRUE;
        """, (page_id,))
        grant_rows = cursor.fetchall()

    allowed_tables = {row["table_name"] for row in grant_rows}

    for table in physical_tables:
        if table.lower() not in allowed_tables:
            return render_error_block(
                "Access Restricted",
                f"You do not have permission to view '{table}'. Contact a book owner or administrator for access."
            )

    # 3. Sandboxed Execution via MySQL Runner & Book Role
    cleaned_sql = sql_text.strip().rstrip(";").strip()
    try:
        with get_runner_db(book_id) as runner_cursor:
            # Enforce max execution time hint
            runner_cursor.execute(f"/*+ MAX_EXECUTION_TIME(3000) */ {cleaned_sql}")
            rows = runner_cursor.fetchall()
            
            if not rows:
                return render_table_html([], [], 0, False)

            columns = list(rows[0].keys())
            max_rows = 500
            truncated = len(rows) > max_rows
            displayed_rows = rows[:max_rows]

            return render_table_html(columns, displayed_rows, len(rows), truncated)

    except Exception as e:
        return render_error_block("Query Error", str(e))

def render_wikilinks(book_id: int, book_slug: str, text: str) -> str:
    """
    Replaces [[target]] and [[target|label]] with clickable links
    or broken-link indicators based on existing pages in the book.
    """
    with get_db() as cursor:
        cursor.execute("SELECT page_id, title, slug FROM Page WHERE book_id = %s;", (book_id,))
        pages = cursor.fetchall()

    page_map = {p["title"].strip().lower(): p for p in pages}

    def replace_link(match):
        # 1. Non-link code blocks and inline code spans are left untouched
        if match.group(1) or match.group(2):
            return match.group(0)

        # 2. Escaped wikilinks: e.g. \[[Title]]
        if match.group("esc_slashes"):
            slashes = match.group("esc_slashes")
            label = match.group("esc_label") or match.group("esc_target")
            if len(slashes) % 2 == 1:
                return f'{slashes[:-1]}[[{label}]]'
            prefix = slashes[:len(slashes) // 2]
            target = match.group("esc_target").strip()
            label = match.group("esc_label").strip() if match.group("esc_label") else target
        else:
            prefix = ""
            target = match.group("wl_target").strip()
            label = match.group("wl_label").strip() if match.group("wl_label") else target

        matched_page = page_map.get(target.lower())
        if matched_page:
            slug = matched_page["slug"]
            page_id = matched_page["page_id"]
            return f'{prefix}<a href="/books/{book_slug}/pages/{slug}" class="folio-wikilink" data-page-id="{page_id}">{html.escape(label)}</a>'
        else:
            return f'{prefix}<span class="folio-wikilink broken-link" title="Page \'{html.escape(target)}\' does not exist">{html.escape(label)}</span>'

    return WIKILINK_SCANNER_REGEX.sub(replace_link, text)

CODE_BLOCK_HTML_REGEX = re.compile(
    r'<pre[^>]*><code(?:\s+class=[\"\']language-([^\"\'>\s]*)[\"\'])?[^>]*>([\s\S]*?)</code></pre>',
    re.IGNORECASE
)

def format_rendered_code_blocks(html_text: str) -> str:
    """Wraps rendered <pre><code> blocks in .folio-code-card with language header."""
    def replacer(m):
        lang = (m.group(1) or "code").strip().upper()
        code_body = m.group(2)
        return (
            f'<div class="folio-code-card">'
            f'<div class="folio-code-header">{html.escape(lang)}</div>'
            f'<pre class="folio-code-pre"><code>{code_body}</code></pre>'
            f'</div>'
        )
    return CODE_BLOCK_HTML_REGEX.sub(replacer, html_text)

markdown_parser = mistune.create_markdown(plugins=["table", "strikethrough", "task_lists"])

TABLE_HTML_REGEX = re.compile(r'<table(?:\s+[^>]*)?>([\s\S]*?)</table>', re.IGNORECASE)

def format_rendered_tables(html_text: str) -> str:
    """
    Wraps rendered markdown <table> elements in .folio-query-box and .folio-table-wrapper
    with .folio-data-table so markdown tables look identical to SQL query tables.
    """
    def replacer(m):
        table_body = m.group(1)
        return (
            f'<div class="folio-query-box folio-markdown-table-box">'
            f'  <div class="folio-table-wrapper">'
            f'    <table class="folio-data-table">{table_body}</table>'
            f'  </div>'
            f'</div>'
        )
    return TABLE_HTML_REGEX.sub(replacer, html_text)

def render_page_content(page_id: int, book_id: int, book_slug: str, raw_markdown: str) -> str:
    """
    Processes raw page markdown into full HTML:
    1. Extracts and executes :::query ... ::: blocks into rendered HTML tables/errors.
    2. Resolves [[wikilinks]] against pages in the same book.
    3. Transforms standard markdown to HTML using Mistune with table plugin.
    4. Formats code blocks and tables into styled cards identical to SQL query boxes.
    5. Injects rendered query blocks into their placeholders.
    """
    if not raw_markdown:
        return ""

    query_placeholders: Dict[str, str] = {}
    counter = 0

    def query_replacer(match):
        nonlocal counter

        # 1. Escaped fenced query: e.g. \```query ... ```
        if match.group("esc_fence"):
            slashes = match.group("esc_fence")
            body = match.group(0)[len(slashes):]
            if len(slashes) % 2 == 1:
                return slashes[:-1] + body
            lang = (match.group("esc_fence_lang") or "").strip().lower()
            if lang in ("query", "sql-query"):
                sql = match.group("esc_fence_code").strip()
                rendered_html = execute_and_render_query(page_id, book_id, sql)
                token = f"<!-- FOLIO_QUERY_BLOCK_{counter} -->"
                query_placeholders[token] = rendered_html
                counter += 1
                return slashes[:len(slashes) // 2] + f"\n\n{token}\n\n"
            return match.group(0)

        # 2. Regular fenced code block: preserve unless active query/sql-query
        if match.group("fence"):
            lang = (match.group("lang") or "").strip().lower()
            if lang in ("query", "sql-query"):
                sql = match.group("code").strip()
                rendered_html = execute_and_render_query(page_id, book_id, sql)
                token = f"<!-- FOLIO_QUERY_BLOCK_{counter} -->"
                query_placeholders[token] = rendered_html
                counter += 1
                return f"\n\n{token}\n\n"
            return match.group(0)

        # 3. Inline code span: preserve completely
        if match.group("ticks"):
            return match.group(0)

        # 4. Escaped colon query: e.g. \:::query ... :::
        if match.group("esc_colon"):
            slashes = match.group("esc_colon")
            body = match.group("esc_colon_body")
            if len(slashes) % 2 == 1:
                body = re.sub(r"\\(:::+)", r"\1", body)
                return slashes[:-1] + body
            # Even slashes -> active query!
            clean_sql = re.sub(r"^:::+\s*query\b", "", body, flags=re.I)
            clean_sql = re.sub(r":::+$", "", clean_sql).strip()
            rendered_html = execute_and_render_query(page_id, book_id, clean_sql)
            token = f"<!-- FOLIO_QUERY_BLOCK_{counter} -->"
            query_placeholders[token] = rendered_html
            counter += 1
            return slashes[:len(slashes) // 2] + f"\n\n{token}\n\n"

        # 5. Escaped single \:::query
        if match.group("esc_single"):
            slashes = match.group("esc_single")
            body = match.group("esc_single_body")
            if len(slashes) % 2 == 1:
                return slashes[:-1] + body
            return slashes[:len(slashes) // 2] + body

        # 6. Active colon query block: :::query ... :::
        if match.group("colon_query"):
            sql = match.group("colon_sql").strip()
            rendered_html = execute_and_render_query(page_id, book_id, sql)
            token = f"<!-- FOLIO_QUERY_BLOCK_{counter} -->"
            query_placeholders[token] = rendered_html
            counter += 1
            return f"\n\n{token}\n\n"

        return match.group(0)

    # 1. Replace query blocks with unique comment placeholders
    processed_md = QUERY_SCANNER_REGEX.sub(query_replacer, raw_markdown)

    # 2. Resolve wikilinks
    processed_md = render_wikilinks(book_id, book_slug, processed_md)

    # 3. Convert markdown to HTML with tables enabled
    rendered_html = markdown_parser(processed_md)
    rendered_html = format_rendered_code_blocks(rendered_html)
    rendered_html = format_rendered_tables(rendered_html)

    # 4. Substitute query placeholders with executed query HTML
    for token, block_html in query_placeholders.items():
        rendered_html = rendered_html.replace(f"<p>{token}</p>", block_html).replace(token, block_html)

    return rendered_html
