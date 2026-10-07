from typing import Tuple, Optional, Set
import sqlglot
from sqlglot import exp

# -----------------------------------------------------------------------------
# Positive Whitelist: Allowed AST Node Types
# -----------------------------------------------------------------------------
ALLOWED_NODE_TYPES = (
    # Query Structure
    exp.Select, exp.From, exp.Join, exp.Where, exp.Group, 
    exp.Having, exp.Order, exp.Limit, exp.Offset, exp.Union,
    exp.With, exp.CTE,
    
    # Identifiers & Column references
    exp.Table, exp.Column, exp.Alias, exp.TableAlias, exp.Star,
    exp.Identifier, exp.Var, exp.DataType, exp.Cast,
    
    # Literals
    exp.Literal, exp.Null, exp.Boolean, exp.Tuple,
    
    # Operators & Conditions
    exp.Binary, exp.Unary, exp.Paren, exp.Ordered,
    exp.And, exp.Or, exp.Not, exp.Between, exp.In, exp.Like, exp.ILike, exp.Is,
    
    # Control Flow
    exp.Case, exp.If,
    
    # Functions
    exp.Func, exp.Anonymous, exp.AggFunc
)

# -----------------------------------------------------------------------------
# Positive Whitelist: Allowed Function Names
# -----------------------------------------------------------------------------
ALLOWED_FUNCTIONS = {
    # Aggregates
    "count", "sum", "avg", "min", "max",
    # String manipulation
    "concat", "upper", "lower", "trim", "ltrim", "rtrim", "substring", "substr", 
    "length", "replace", "coalesce", "ifnull",
    # Mathematical
    "abs", "round", "floor", "ceil", "ceiling", "sqrt", "mod",
    # Date & Time (Read-only extraction)
    "now", "curdate", "curtime", "date", "year", "month", "day", "hour", "minute", 
    "second", "date_format", "datediff"
}

def validate_select_query(sql_text: str) -> Tuple[bool, Optional[str], Set[str]]:
    """
    Validates a SQL query using AST parsing (sqlglot) against a strict Positive Whitelist.
    
    Returns:
        (is_valid: bool, error_message: Optional[str], physical_tables: Set[str])
    """
    cleaned_sql = sql_text.strip().rstrip(";").strip()
    if not cleaned_sql:
        return False, "Query block is empty.", set()

    # 1. Parse statement count (blocks multi-statement injection like 'SELECT 1; DROP TABLE...')
    try:
        statements = sqlglot.parse(cleaned_sql, read="mysql")
    except Exception as e:
        return False, f"SQL Syntax Error: {str(e)}", set()

    if not statements or len(statements) != 1:
        return False, "Only a single SQL statement is allowed per query block.", set()

    statement = statements[0]

    # 2. Verify root statement is SELECT or UNION
    if not isinstance(statement, (exp.Select, exp.Union)):
        return False, f"Only SELECT statements are permitted (received {type(statement).__name__}).", set()

    # 3. Walk the AST with Positive Whitelist (Default-Deny)
    for node in statement.walk():
        # Check node type against allowed whitelist
        if not isinstance(node, ALLOWED_NODE_TYPES):
            node_type = type(node).__name__
            return False, f"Prohibited or unsupported SQL element '{node_type}'.", set()

        # Check function against allowed functions whitelist
        if isinstance(node, (exp.Func, exp.Anonymous, exp.AggFunc)):
            func_name = node.name if isinstance(node, exp.Anonymous) else (node.sql_name() or getattr(node, "key", None) or type(node).__name__)
            if not func_name or func_name.lower() not in ALLOWED_FUNCTIONS:
                return False, f"Function '{func_name}()' is not permitted.", set()

    # 4. Extract physical table names (excluding CTE aliases)
    cte_aliases = set()
    for cte in statement.find_all(exp.CTE):
        if cte.alias:
            cte_aliases.add(cte.alias.lower())

    physical_tables = set()
    for table_node in statement.find_all(exp.Table):
        tname = table_node.name.strip()
        if tname and tname.lower() not in cte_aliases:
            physical_tables.add(tname)

    if not physical_tables:
        return False, "Query must specify at least one target table to query.", set()

    return True, None, physical_tables
