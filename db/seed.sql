-- =============================================================================
-- Folio Seed Data
-- =============================================================================

-- Clean up existing data in reverse dependency order
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE PagePermission;
TRUNCATE TABLE PageTableGrants;
TRUNCATE TABLE QueryableTables;
TRUNCATE TABLE QueryableDatabases;
TRUNCATE TABLE PageTags;
TRUNCATE TABLE Tag;
TRUNCATE TABLE Backlinks;
TRUNCATE TABLE Edits;
TRUNCATE TABLE EditHistory;
TRUNCATE TABLE Page;
TRUNCATE TABLE Book;
TRUNCATE TABLE User;
SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- 1. Users
-- -----------------------------------------------------------------------------
INSERT INTO User (user_id, name) VALUES
(1, 'Alice Chen'),
(2, 'Bob Smith');

-- -----------------------------------------------------------------------------
-- 2. Books
-- -----------------------------------------------------------------------------
INSERT INTO Book (book_id, title, slug) VALUES
(1, 'DBMS 101 Notes', 'dbms-101-notes'),
(2, 'Personal Journal', 'personal-journal');

-- -----------------------------------------------------------------------------
-- 3. Pages (Demonstrates 3-level hierarchy in Book 1)
-- -----------------------------------------------------------------------------
-- Root pages (parent_page_id IS NULL)
INSERT INTO Page (page_id, book_id, parent_page_id, title, slug, position) VALUES
(1, 1, NULL, 'Course Overview', 'course-overview', 1),
(2, 1, NULL, 'Relational Model', 'relational-model', 2);

-- Sub-pages under 'Relational Model' (page_id = 2)
INSERT INTO Page (page_id, book_id, parent_page_id, title, slug, position) VALUES
(3, 1, 2, 'SQL Basics', 'sql-basics', 1),
(4, 1, 2, 'Normalization', 'normalization', 2);

-- Sub-sub-page under 'SQL Basics' (page_id = 3)
INSERT INTO Page (page_id, book_id, parent_page_id, title, slug, position) VALUES
(5, 1, 3, 'Recursive Queries', 'recursive-queries', 1);

-- Root page in Book 2
INSERT INTO Page (page_id, book_id, parent_page_id, title, slug, position) VALUES
(6, 2, NULL, 'Welcome Page', 'welcome-page', 1);

-- -----------------------------------------------------------------------------
-- 4. Edit History & Snapshots (Vertical partitioning)
-- -----------------------------------------------------------------------------
INSERT INTO EditHistory (edit_id, user_id, page_id, action) VALUES
(1, 1, 1, 'CREATE'),
(2, 1, 2, 'CREATE'),
(3, 1, 3, 'CREATE'),
(4, 1, 4, 'CREATE'),
(5, 2, 5, 'CREATE'),
(6, 2, 5, 'EDIT');

INSERT INTO Edits (edit_id, snapshot) VALUES
(1, '# Course Overview\n\nWelcome to DBMS 101. See [[Relational Model]] for core concepts.'),
(2, '# Relational Model\n\nFoundation of modern databases. Check [[SQL Basics]] to get started.'),
(3, '# SQL Basics\n\nBasic syntax and DDL/DML. Advanced topics in [[Recursive Queries]].'),
(4, '# Normalization\n\n1NF through BCNF.'),
(5, '# Recursive Queries\n\nInitial draft of CTE notes.'),
(6, '# Recursive Queries\n\nCTE notes with backlinks to [[Course Overview]] and query demonstrations.');

-- -----------------------------------------------------------------------------
-- 5. Backlinks (Extracted from [[wikilinks]])
-- -----------------------------------------------------------------------------
-- Page 1 (Course Overview) links to Page 2 (Relational Model)
-- Page 2 (Relational Model) links to Page 3 (SQL Basics)
-- Page 3 (SQL Basics) links to Page 5 (Recursive Queries)
-- Page 5 (Recursive Queries) links back to Page 1 (Course Overview)
INSERT INTO Backlinks (page_id_from, page_id_to) VALUES
(1, 2),
(2, 3),
(3, 5),
(5, 1);

-- -----------------------------------------------------------------------------
-- 6. Tags & PageTags (Many-to-Many)
-- -----------------------------------------------------------------------------
INSERT INTO Tag (tag_id, name) VALUES
(1, 'theory'),
(2, 'sql'),
(3, 'exam-prep');

INSERT INTO PageTags (page_id, tag_id) VALUES
(1, 1), -- Course Overview: theory
(2, 1), -- Relational Model: theory
(2, 3), -- Relational Model: exam-prep
(3, 2), -- SQL Basics: sql
(4, 1), -- Normalization: theory
(4, 3), -- Normalization: exam-prep
(5, 2), -- Recursive Queries: sql
(5, 3); -- Recursive Queries: exam-prep

-- -----------------------------------------------------------------------------
-- 7. Queryable Demo Dataset & Whitelist
-- -----------------------------------------------------------------------------
-- Create a sample demo table that embedded query blocks can query against
CREATE TABLE IF NOT EXISTS StudentGrades (
    student_id INT AUTO_INCREMENT PRIMARY KEY,
    student_name VARCHAR(100) NOT NULL,
    assignment VARCHAR(100) NOT NULL,
    score DECIMAL(5, 2) NOT NULL
);

INSERT INTO StudentGrades (student_name, assignment, score) VALUES
('Alice Chen', 'HW1 - Schema Design', 98.50),
('Alice Chen', 'HW2 - SQL Queries', 95.00),
('Bob Smith', 'HW1 - Schema Design', 88.00),
('Bob Smith', 'HW2 - SQL Queries', 91.50),
('Charlie Brown', 'HW1 - Schema Design', 74.00);

-- Register demo database and table in the whitelist
INSERT INTO QueryableDatabases (db_name) VALUES
('folio_db');

INSERT INTO QueryableTables (table_id, table_name, db) VALUES
(1, 'StudentGrades', 'folio_db');

-- Grant access to Page 3 (SQL Basics) and Page 5 (Recursive Queries)
INSERT INTO PageTableGrants (grant_id, page_id, table_id) VALUES
(1, 3, 1),
(2, 5, 1);

INSERT INTO PagePermission (grant_id, can_read, can_write) VALUES
(1, TRUE, FALSE),
(2, TRUE, FALSE);
