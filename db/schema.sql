-- Users
CREATE TABLE User (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Book db
CREATE TABLE Book (
    book_id INT AUTO_INCREMENT PRIMARY KEY,
    owner_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES User(user_id) ON DELETE CASCADE
);

-- Book Collaboration / Sharing (Role-Based Access Control)
CREATE TABLE BookCollaborators (
    book_id INT NOT NULL,
    user_id INT NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'EDITOR' CHECK (role IN ('VIEWER', 'EDITOR', 'ADMIN')),
    PRIMARY KEY (book_id, user_id),
    FOREIGN KEY (book_id) REFERENCES Book(book_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES User(user_id) ON DELETE CASCADE
);

-- Page db
CREATE TABLE Page (
    page_id INT AUTO_INCREMENT PRIMARY KEY,
    book_id INT NOT NULL,
    parent_page_id INT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    position INT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES Book(book_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_page_id) REFERENCES Page(page_id) ON DELETE SET NULL,
    UNIQUE KEY (parent_page_id, position),
    UNIQUE KEY (book_id, slug)
);

-- Edit history
CREATE TABLE EditHistory(
    edit_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    page_id INT NOT NULL,
    edit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    action VARCHAR(50) NOT NULL CHECK(action IN ('CREATE', 'EDIT')),
    FOREIGN KEY (user_id) REFERENCES User(user_id) ON DELETE SET NULL,
    FOREIGN KEY (page_id) REFERENCES Page(page_id) ON DELETE CASCADE
);

CREATE TABLE Edits(
    edit_id INT NOT NULL PRIMARY KEY,
    snapshot LONGTEXT NOT NULL,
    FOREIGN KEY (edit_id) REFERENCES EditHistory(edit_id) ON DELETE CASCADE
);

CREATE TABLE Backlinks(
    link_id INT AUTO_INCREMENT PRIMARY KEY,
    page_id_from INT NOT NULL,
    page_id_to INT NOT NULL,
    FOREIGN KEY (page_id_from) REFERENCES Page(page_id) ON DELETE CASCADE,
    FOREIGN KEY (page_id_to) REFERENCES Page(page_id) ON DELETE CASCADE,
    UNIQUE KEY (page_id_from, page_id_to)
);


CREATE TABLE Tag (
    tag_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL
);


CREATE TABLE PageTags (
    page_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (page_id, tag_id),
    FOREIGN KEY (page_id) REFERENCES Page(page_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES Tag(tag_id) ON DELETE CASCADE
);


CREATE TABLE QueryableDatabases(
    db_name VARCHAR(255) PRIMARY KEY
);

CREATE TABLE QueryableTables(
    table_id INT AUTO_INCREMENT PRIMARY KEY,
    table_name VARCHAR(255) NOT NULL,
    db VARCHAR(255) NOT NULL,
    FOREIGN KEY (db) REFERENCES QueryableDatabases(db_name) ON DELETE CASCADE,
    UNIQUE KEY (table_name, db)
);

CREATE TABLE BookTableGrants(
    grant_id INT AUTO_INCREMENT PRIMARY KEY,
    book_id INT NOT NULL,
    table_id INT NOT NULL,
    can_read BOOLEAN DEFAULT TRUE,
    can_write BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (book_id) REFERENCES Book(book_id) ON DELETE CASCADE,
    FOREIGN KEY (table_id) REFERENCES QueryableTables(table_id) ON DELETE CASCADE,
    UNIQUE KEY uq_book_table (book_id, table_id)
);

CREATE TABLE PageTableGrants(
    grant_id INT AUTO_INCREMENT PRIMARY KEY,
    page_id INT NOT NULL,
    table_id INT NOT NULL,
    FOREIGN KEY (page_id) REFERENCES Page(page_id) ON DELETE CASCADE,
    FOREIGN KEY (table_id) REFERENCES QueryableTables(table_id) ON DELETE CASCADE,
    UNIQUE KEY (page_id, table_id)
);

CREATE TABLE PagePermission(
    grant_id INT NOT NULL PRIMARY KEY,
    can_read BOOLEAN DEFAULT FALSE,
    can_write BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (grant_id) REFERENCES PageTableGrants(grant_id) ON DELETE CASCADE
);

-- =============================================================================
-- VIEWS
-- =============================================================================
-- Two-tier permission resolution view (Page override takes priority over Book default)
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