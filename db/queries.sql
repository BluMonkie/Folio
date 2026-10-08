-- =============================================================================
-- FOLIO: Comprehensive SQL Query Catalog
-- DBMS Course Project — Complete Catalog of Backend SQL Statements
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. AUTHENTICATION & USER MANAGEMENT
-- -----------------------------------------------------------------------------

-- 1.1 Verify Email Uniqueness on Signup
SELECT user_id 
FROM User 
WHERE email = %s;

-- 1.2 Register New User
INSERT INTO User (name, email, password_hash) 
VALUES (%s, %s, %s);

-- 1.3 Fetch User Profile by ID (Token Validation / /auth/me)
SELECT user_id, name, email, created_at 
FROM User 
WHERE user_id = %s;

-- 1.4 User Login Authentication by Email
SELECT user_id, name, email, password_hash, created_at 
FROM User 
WHERE email = %s;


-- -----------------------------------------------------------------------------
-- 2. BOOKS & COLLABORATION (RBAC)
-- -----------------------------------------------------------------------------

-- 2.1 Check Book Ownership (Base Authorization)
SELECT owner_id 
FROM Book 
WHERE book_id = %s;

-- 2.2 Check Collaborator Role on a Book
SELECT role 
FROM BookCollaborators 
WHERE book_id = %s AND user_id = %s;

-- 2.3 List Accessible Books with Aggregated Page Counts
-- Concept: Multi-table JOIN with conditional aggregation & RBAC filtering
SELECT 
    b.book_id, 
    b.owner_id, 
    u.name AS owner_name, 
    b.title, 
    b.slug, 
    b.created_at, 
    COUNT(DISTINCT p.page_id) AS total_pages,
    CASE 
        WHEN b.owner_id = %s THEN 'OWNER'
        ELSE bc.role 
    END AS user_role
FROM Book b
JOIN User u ON b.owner_id = u.user_id
LEFT JOIN BookCollaborators bc ON b.book_id = bc.book_id AND bc.user_id = %s
LEFT JOIN Page p ON b.book_id = p.book_id
WHERE b.owner_id = %s OR bc.user_id = %s
GROUP BY b.book_id, b.owner_id, u.name, b.title, b.slug, b.created_at, bc.role
ORDER BY total_pages DESC, b.title ASC;

-- 2.4 Check Book Slug Uniqueness
SELECT book_id 
FROM Book 
WHERE slug = %s;

-- 2.5 Insert New Book
INSERT INTO Book (owner_id, title, slug) 
VALUES (%s, %s, %s);

-- 2.6 Fetch Single Book Metadata
SELECT 
    b.book_id, 
    b.owner_id, 
    u.name AS owner_name, 
    b.title, 
    b.slug, 
    b.created_at,
    COUNT(DISTINCT p.page_id) AS total_pages
FROM Book b
JOIN User u ON b.owner_id = u.user_id
LEFT JOIN Page p ON b.book_id = p.book_id
WHERE b.book_id = %s
GROUP BY b.book_id, b.owner_id, u.name, b.title, b.slug, b.created_at;

-- 2.7 Delete Book (Triggers ON DELETE CASCADE across Pages, Grants, Collaborators)
DELETE FROM Book 
WHERE book_id = %s;

-- 2.8 List Collaborators for a Book
SELECT u.user_id, u.name, u.email, bc.role
FROM BookCollaborators bc
JOIN User u ON bc.user_id = u.user_id
WHERE bc.book_id = %s
ORDER BY u.name ASC;

-- 2.9 Add or Update Collaborator Role (Upsert Pattern)
INSERT INTO BookCollaborators (book_id, user_id, role)
VALUES (%s, %s, %s)
ON DUPLICATE KEY UPDATE role = VALUES(role);

-- 2.10 Remove Collaborator from a Book
DELETE FROM BookCollaborators 
WHERE book_id = %s AND user_id = %s;


-- -----------------------------------------------------------------------------
-- 3. HIERARCHICAL PAGE MANAGEMENT & RECURSIVE CTE
-- -----------------------------------------------------------------------------

-- 3.1 Recursive CTE: Full Page Tree Traversal with Depth and Breadcrumb Path
-- Concept: Recursive Common Table Expression (Anchor + Inductive Member)
WITH RECURSIVE page_tree AS (
    -- 1. Anchor Member: Top-level root chapters (parent_page_id IS NULL)
    SELECT 
        page_id, 
        parent_page_id, 
        book_id,
        title, 
        slug, 
        position,
        0 AS depth,
        CAST(title AS CHAR(1000)) AS breadcrumb
    FROM Page
    WHERE book_id = %s AND parent_page_id IS NULL

    UNION ALL

    -- 2. Recursive Member: Child pages joined to their parents
    SELECT 
        child.page_id, 
        child.parent_page_id, 
        child.book_id,
        child.title, 
        child.slug, 
        child.position,
        parent.depth + 1,
        CONCAT(parent.breadcrumb, ' > ', child.title)
    FROM Page child
    JOIN page_tree parent ON child.parent_page_id = parent.page_id
)
-- 3. Output Traversal Order
SELECT 
    page_id, 
    parent_page_id, 
    title, 
    slug, 
    position, 
    depth, 
    breadcrumb 
FROM page_tree 
ORDER BY depth, position;

-- 3.2 Validate Parent Page Belongs to the Same Book
SELECT page_id 
FROM Page 
WHERE page_id = %s AND book_id = %s;

-- 3.3 Check Page Slug Uniqueness within Book
SELECT page_id 
FROM Page 
WHERE book_id = %s AND slug = %s;

-- 3.4 Auto-Compute Next Sibling Position (Root Pages)
SELECT COALESCE(MAX(position), 0) + 1 AS next_pos 
FROM Page 
WHERE book_id = %s AND parent_page_id IS NULL;

-- 3.5 Auto-Compute Next Sibling Position (Nested Pages)
SELECT COALESCE(MAX(position), 0) + 1 AS next_pos 
FROM Page 
WHERE book_id = %s AND parent_page_id = %s;

-- 3.6 Insert Page Row
INSERT INTO Page (book_id, parent_page_id, title, slug, position) 
VALUES (%s, %s, %s, %s, %s);

-- 3.7 Retrieve Page Metadata with Book Slug
SELECT 
    p.page_id, 
    p.book_id, 
    p.parent_page_id, 
    p.title, 
    p.slug, 
    p.position,
    b.slug AS book_slug
FROM Page p
JOIN Book b ON p.book_id = b.book_id
WHERE p.page_id = %s;

-- 3.8 Update Page Metadata
UPDATE Page 
SET title = %s, slug = %s, parent_page_id = %s, position = %s 
WHERE page_id = %s;

-- 3.9 Delete Page (Cascades remove backlinks, tags, and page grants)
DELETE FROM Page 
WHERE page_id = %s;


-- -----------------------------------------------------------------------------
-- 4. VERTICAL PARTITIONING: AUDIT LOG & SNAPSHOT HISTORY
-- -----------------------------------------------------------------------------

-- 4.1 Insert Edit History Metadata Event
INSERT INTO EditHistory (user_id, page_id, action) 
VALUES (%s, %s, %s);

-- 4.2 Insert Heavy Snapshot into Vertically Partitioned Edits Table
INSERT INTO Edits (edit_id, snapshot) 
VALUES (%s, %s);

-- 4.3 Retrieve Page Audit Trail with Author Information
SELECT 
    eh.edit_id,
    eh.user_id,
    u.name AS user_name,
    eh.edit_time,
    eh.action,
    e.snapshot
FROM EditHistory eh
JOIN Edits e ON eh.edit_id = e.edit_id
LEFT JOIN User u ON eh.user_id = u.user_id
WHERE eh.page_id = %s
ORDER BY eh.edit_time DESC;


-- -----------------------------------------------------------------------------
-- 5. KNOWLEDGE GRAPH & BACKLINKS
-- -----------------------------------------------------------------------------

-- 5.1 Delete Outdated Outgoing Backlinks for a Page
DELETE FROM Backlinks 
WHERE page_id_from = %s;

-- 5.2 Resolve Wikilink Target Titles (Case-Insensitive Batch Lookup)
SELECT page_id 
FROM Page 
WHERE book_id = %s AND LOWER(title) IN (%s, %s, ...);

-- 5.3 Insert Resolved Wikilink Edge
INSERT IGNORE INTO Backlinks (page_id_from, page_id_to) 
VALUES (%s, %s);

-- 5.4 Fetch Ingoing Backlinks (Pages Referencing the Target Page)
SELECT 
    p.page_id, 
    p.title, 
    p.slug 
FROM Backlinks b
JOIN Page p ON b.page_id_from = p.page_id
WHERE b.page_id_to = %s
ORDER BY p.title ASC;

-- 5.5 Fetch All Pages for a Book (Used by Markdown Renderer to Resolve Wikilinks)
SELECT page_id, title, slug 
FROM Page 
WHERE book_id = %s;


-- -----------------------------------------------------------------------------
-- 6. TAGS & TAXONOMY (MANY-TO-MANY)
-- -----------------------------------------------------------------------------

-- 6.1 List All Tags with Usage Counts
SELECT 
    t.tag_id, 
    t.name, 
    COUNT(pt.page_id) AS page_count
FROM Tag t
LEFT JOIN PageTags pt ON t.tag_id = pt.tag_id
GROUP BY t.tag_id, t.name
ORDER BY page_count DESC, t.name ASC;

-- 6.2 Lookup Tag by Name
SELECT tag_id, name 
FROM Tag 
WHERE name = %s;

-- 6.3 Insert New Tag
INSERT INTO Tag (name) 
VALUES (%s);

-- 6.4 List Tags Associated with a Page
SELECT t.tag_id, t.name
FROM PageTags pt
JOIN Tag t ON pt.tag_id = t.tag_id
WHERE pt.page_id = %s
ORDER BY t.name ASC;

-- 6.5 Associate Tag with Page
INSERT IGNORE INTO PageTags (page_id, tag_id) 
VALUES (%s, %s);

-- 6.6 Remove Tag from Page
DELETE FROM PageTags 
WHERE page_id = %s AND tag_id = %s;

-- 6.7 Filter Pages by Tag (Respecting User Authorization)
SELECT 
    p.page_id, 
    p.book_id, 
    p.title, 
    p.slug, 
    b.title AS book_title, 
    b.slug AS book_slug
FROM PageTags pt
JOIN Page p ON pt.page_id = p.page_id
JOIN Book b ON p.book_id = b.book_id
LEFT JOIN BookCollaborators bc ON b.book_id = bc.book_id AND bc.user_id = %s
WHERE pt.tag_id = %s AND (b.owner_id = %s OR bc.user_id = %s)
ORDER BY b.title ASC, p.title ASC;


-- -----------------------------------------------------------------------------
-- 7. DYNAMIC SQL ENGINE & TWO-TIER PERMISSION RESOLUTION
-- -----------------------------------------------------------------------------

-- 7.1 List Registered Queryable Tables Catalog
SELECT table_id, table_name, db 
FROM QueryableTables 
ORDER BY db ASC, table_name ASC;

-- 7.2 List Book-Level Default Grants
SELECT 
    btg.grant_id,
    btg.book_id,
    btg.table_id,
    qt.table_name,
    qt.db,
    btg.can_read,
    btg.can_write
FROM BookTableGrants btg
JOIN QueryableTables qt ON btg.table_id = qt.table_id
WHERE btg.book_id = %s
ORDER BY qt.table_name ASC;

-- 7.3 Grant / Update Book-Level Table Access (Upsert Pattern)
INSERT INTO BookTableGrants (book_id, table_id, can_read, can_write)
VALUES (%s, %s, %s, %s)
ON DUPLICATE KEY UPDATE can_read = VALUES(can_read), can_write = VALUES(can_write);

-- 7.4 Revoke Book-Level Table Access
DELETE FROM BookTableGrants 
WHERE grant_id = %s AND book_id = %s;

-- 7.5 Database View: Two-Tier Permission Resolution (v_EffectivePageGrants)
-- Concept: Database View encapsulating multi-table outer joins & conditional priority logic
CREATE OR REPLACE VIEW v_EffectivePageGrants AS
SELECT 
    p.page_id,
    p.book_id,
    qt.table_id,
    qt.table_name,
    qt.db,
    CASE 
        WHEN ptg.grant_id IS NOT NULL THEN COALESCE(pp.can_read, FALSE)
        WHEN btg.grant_id IS NOT NULL THEN btg.can_read
        ELSE FALSE
    END AS can_read,
    CASE 
        WHEN ptg.grant_id IS NOT NULL THEN COALESCE(pp.can_write, FALSE)
        WHEN btg.grant_id IS NOT NULL THEN btg.can_write
        ELSE FALSE
    END AS can_write,
    CASE 
        WHEN ptg.grant_id IS NOT NULL THEN 'PAGE'
        WHEN btg.grant_id IS NOT NULL THEN 'BOOK'
        ELSE 'NONE'
    END AS source_tier,
    (ptg.grant_id IS NOT NULL) AS is_override,
    ptg.grant_id AS page_grant_id,
    btg.grant_id AS book_grant_id
FROM Page p
CROSS JOIN QueryableTables qt
LEFT JOIN PageTableGrants ptg ON ptg.page_id = p.page_id AND ptg.table_id = qt.table_id
LEFT JOIN PagePermission pp ON ptg.grant_id = pp.grant_id
LEFT JOIN BookTableGrants btg ON btg.book_id = p.book_id AND btg.table_id = qt.table_id;

-- 7.6 Querying Effective Grants for a Page (Used by API & Renderer)
-- Concept: Querying a View with predicate pushdown (View Merge Optimization)
SELECT 
    table_id,
    table_name,
    db,
    can_read,
    can_write,
    source_tier,
    is_override,
    page_grant_id,
    book_grant_id
FROM v_EffectivePageGrants
WHERE page_id = %s AND can_read = TRUE
ORDER BY table_name ASC;

-- 7.7 Grant / Update Explicit Page-Level Override
INSERT INTO PageTableGrants (page_id, table_id) 
VALUES (%s, %s);

INSERT INTO PagePermission (grant_id, can_read, can_write)
VALUES (%s, %s, %s)
ON DUPLICATE KEY UPDATE can_read = VALUES(can_read), can_write = VALUES(can_write);

-- 7.7 Revoke Page-Level Override (Falls back to Book default if available)
DELETE FROM PageTableGrants 
WHERE grant_id = %s AND page_id = %s;

-- 7.8 Check Remaining Page Grants Before Role Revocation
SELECT COUNT(*) AS active_count
FROM PageTableGrants ptg
JOIN Page p ON ptg.page_id = p.page_id
JOIN PagePermission pp ON ptg.grant_id = pp.grant_id
WHERE p.book_id = %s AND ptg.table_id = %s AND pp.can_read = 1;


-- -----------------------------------------------------------------------------
-- 8. MYSQL 8.0 DDL & ROLE-BASED ACCESS CONTROL
-- -----------------------------------------------------------------------------

-- 8.1 Provision Book-Scoped Role
CREATE ROLE IF NOT EXISTS 'role_book_1';

-- 8.2 Assign Book Role to Unprivileged Query Runner
GRANT 'role_book_1' TO 'folio_runner'@'localhost';

-- 8.3 Grant Table-Level SELECT to Book Role
GRANT SELECT ON `folio_db`.`StudentGrades` TO 'role_book_1';

-- 8.4 Revoke Table SELECT from Book Role
REVOKE SELECT ON `folio_db`.`StudentGrades` FROM 'role_book_1';

-- 8.5 Drop Book Role on Book Deletion
DROP ROLE IF EXISTS 'role_book_1';

-- 8.6 Sandboxed Runner Session Initialization
SET ROLE 'role_book_1';
USE `folio_db`;
SET SESSION max_execution_time = 3000;
START TRANSACTION READ ONLY;
-- User query executed with hint:
/*+ MAX_EXECUTION_TIME(3000) */ SELECT * FROM StudentGrades;
ROLLBACK;


-- -----------------------------------------------------------------------------
-- 9. SYSTEM HEALTH & MONITORING
-- -----------------------------------------------------------------------------

-- 9.1 Database Health Check Endpoint (/health)
SELECT COUNT(*) AS book_count 
FROM Book;


-- -----------------------------------------------------------------------------
-- 10. SEARCH & DISCOVERY ENGINE
-- -----------------------------------------------------------------------------

-- 10.1 Multi-Tier Relevance Search across Titles, Tags, and Document Snapshots
-- Concepts: CTEs, Window Functions (ROW_NUMBER OVER PARTITION), String Aggregation (GROUP_CONCAT),
-- Weighted Relevance Scoring, and RBAC Filter
WITH latest_edits AS (
    SELECT 
        eh.page_id, 
        e.snapshot,
        ROW_NUMBER() OVER (PARTITION BY eh.page_id ORDER BY eh.edit_id DESC) AS rn
    FROM EditHistory eh
    JOIN Edits e ON eh.edit_id = e.edit_id
),
page_tags_agg AS (
    SELECT 
        pt.page_id,
        GROUP_CONCAT(t.name SEPARATOR ', ') AS tag_names
    FROM PageTags pt
    JOIN Tag t ON pt.tag_id = t.tag_id
    GROUP BY pt.page_id
)
SELECT 
    p.page_id,
    p.book_id,
    b.title AS book_title,
    b.slug AS book_slug,
    p.title AS page_title,
    p.slug AS page_slug,
    COALESCE(pta.tag_names, '') AS tags_csv,
    (
        CASE WHEN LOWER(p.title) LIKE LOWER(%s) THEN 100 ELSE 0 END +
        CASE WHEN LOWER(pta.tag_names) LIKE LOWER(%s) THEN 50 ELSE 0 END +
        CASE WHEN LOWER(le.snapshot) LIKE LOWER(%s) THEN 20 ELSE 0 END
    ) AS relevance_score,
    CASE 
        WHEN LOWER(p.title) LIKE LOWER(%s) THEN 'TITLE'
        WHEN LOWER(pta.tag_names) LIKE LOWER(%s) THEN 'TAG'
        ELSE 'CONTENT'
    END AS primary_match,
    le.snapshot
FROM Page p
JOIN Book b ON p.book_id = b.book_id
LEFT JOIN BookCollaborators bc ON b.book_id = bc.book_id AND bc.user_id = %s
LEFT JOIN latest_edits le ON le.page_id = p.page_id AND le.rn = 1
LEFT JOIN page_tags_agg pta ON pta.page_id = p.page_id
WHERE (b.owner_id = %s OR bc.user_id = %s)
  -- Optional book scope filter: AND p.book_id = %s
  AND (
      LOWER(p.title) LIKE LOWER(%s)
      OR LOWER(pta.tag_names) LIKE LOWER(%s)
      OR LOWER(le.snapshot) LIKE LOWER(%s)
  )
ORDER BY relevance_score DESC, p.title ASC;