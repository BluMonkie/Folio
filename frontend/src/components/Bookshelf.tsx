import React, { useState, useEffect } from "react";
import type { Book, UserProfile } from "../api";

interface RecentPageItem {
  page_id: number;
  book_id: number;
  book_title: string;
  title: string;
  slug: string;
  breadcrumb?: string;
  wordCount?: number;
}

interface BookshelfProps {
  currentUser: UserProfile | null;
  books: Book[];
  recentPages: RecentPageItem[];
  onSelectBook: (book: Book) => void;
  onSelectPage: (pageId: number) => void;
  onCreateBook: () => void;
  onCreatePage: () => void;
  onDeleteBook?: (bookId: number) => void;
  onRenameBook?: (bookId: number, newTitle: string) => void;
}

export const Bookshelf: React.FC<BookshelfProps> = ({
  currentUser,
  books,
  recentPages,
  onSelectBook,
  onSelectPage,
  onCreateBook,
  onCreatePage,
  onDeleteBook,
  onRenameBook,
}) => {
  const [filter, setFilter] = useState<"all" | "recent" | "pinned">("all");
  const [bookContextMenu, setBookContextMenu] = useState<{ x: number; y: number; book: Book } | null>(null);
  const [renamingBook, setRenamingBook] = useState<{ bookId: number; title: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 2500);
  };

  useEffect(() => {
    if (!bookContextMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#folio-bookshelf-book-context-menu")) {
        setBookContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBookContextMenu(null);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [bookContextMenu]);

  const handleBookContextMenu = (e: React.MouseEvent, book: Book) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 220;
    const menuHeight = 220;
    const x = Math.min(e.clientX, Math.max(10, window.innerWidth - menuWidth - 10));
    const y = Math.min(e.clientY, Math.max(10, window.innerHeight - menuHeight - 10));

    setBookContextMenu({ x, y, book });
  };

  const totalNotes = books.reduce((acc, b) => acc + (b.total_pages || 0), 0);

  // Helper book emblems
  const getBookIcon = (slug: string) => {
    if (slug.includes("database") || slug.includes("architecture")) return "account_tree";
    if (slug.includes("algorithm") || slug.includes("philosophy")) return "psychology";
    if (slug.includes("zettel") || slug.includes("note")) return "auto_stories";
    return "menu_book";
  };

  return (
    <div className="w-full space-y-8 animate-fadeIn pb-12">
      {/* 1. Editorial Greeting & Quick Action Bar */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 pt-2">
        <div>
          <h1 className="text-3xl sm:text-4xl font-normal text-[#1f1b17] tracking-tight font-serif-editorial">
            Good day, {currentUser?.name || "Scholar"}.
          </h1>
          <p className="text-[15px] text-[#554336] mt-1 max-w-xl leading-relaxed">
            Your knowledge base contains {totalNotes} connected notes across {books.length} bookshelves. Everything is saved and organized.
          </p>
        </div>

        {/* Action Triggers */}
        <div className="flex items-center gap-2.5 self-start md:self-auto shrink-0">
          <button
            onClick={onCreateBook}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f0e6e0] hover:bg-[#eae1da] text-[#1f1b17] text-sm font-semibold shadow-xs transition-colors group cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-[18px] text-[#8d4b00] group-hover:rotate-45 transition-transform duration-200">
              add
            </span>
            <span>New Book</span>
          </button>
          <button
            onClick={onCreatePage}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#d97706] hover:bg-[#b45309] text-white text-sm font-semibold shadow-sm transition-colors cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">edit_note</span>
            <span>Quick Note</span>
            <kbd className="font-mono-editorial text-[11px] px-1.5 py-0.5 rounded bg-black/20 text-white font-normal">
              ⌘N
            </kbd>
          </button>
        </div>
      </section>

      {/* 2. Categorical Filter Strip */}
      <section className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => setFilter("all")}
          className={`folio-pill-filter cursor-pointer ${
            filter === "all"
              ? "bg-white text-[#8d4b00] shadow-2xs border border-[#e7e5e4] font-semibold"
              : "text-[#554336] hover:bg-[#f0e6e0]"
          }`}
          type="button"
        >
          All Books ({books.length})
        </button>
        <button
          onClick={() => setFilter("recent")}
          className={`folio-pill-filter cursor-pointer ${
            filter === "recent"
              ? "bg-white text-[#8d4b00] shadow-2xs border border-[#e7e5e4] font-semibold"
              : "text-[#554336] hover:bg-[#f0e6e0]"
          }`}
          type="button"
        >
          Recent
        </button>
        <button
          onClick={() => setFilter("pinned")}
          className={`folio-pill-filter cursor-pointer ${
            filter === "pinned"
              ? "bg-white text-[#8d4b00] shadow-2xs border border-[#e7e5e4] font-semibold"
              : "text-[#554336] hover:bg-[#f0e6e0]"
          }`}
          type="button"
        >
          Pinned
        </button>
      </section>

      {/* 3. Visual Bookshelves Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h2 className="text-xl sm:text-2xl font-bold text-[#1f1b17] tracking-tight">Your books</h2>
            <span className="text-xs text-[#78716c] font-medium">{books.length} collections</span>
          </div>
        </div>

        {/* Book Covers Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {books.map((book) => (
            <article
              key={book.book_id}
              onClick={() => onSelectBook(book)}
              onContextMenu={(e) => handleBookContextMenu(e, book)}
              className="group relative flex flex-col justify-between rounded-xl bg-white border border-[#e7e5e4] overflow-hidden shadow-xs hover:shadow-md hover:border-[#dbc2b0] transition-all duration-200 cursor-pointer"
              title={`${book.title} (Right-click for options)`}
            >
              {/* Spine Accent Strip */}
              <div className="h-24 w-full bg-[#fcf2eb] flex items-center justify-between px-5 relative overflow-hidden border-b border-[#e7e5e4]">
                <div className="absolute inset-0 bg-[#d97706]/5"></div>
                <div className="w-11 h-11 rounded-xl bg-white shadow-xs border border-[#e7e5e4] flex items-center justify-center text-[#8d4b00] relative z-10">
                  <span className="material-symbols-outlined text-[22px]">
                    {getBookIcon(book.slug)}
                  </span>
                </div>
                <div className="flex items-center gap-1 relative z-10">
                  <span className="folio-pill-badge bg-white/95 text-[#554336] border border-[#e7e5e4] font-mono">
                    /{book.slug}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleBookContextMenu(e, book);
                    }}
                    className="p-1 rounded bg-white/90 hover:bg-white text-[#78716c] hover:text-[#1f1b17] border border-[#e7e5e4] shadow-2xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center"
                    title="Book options"
                  >
                    <span className="material-symbols-outlined text-[16px]">more_vert</span>
                  </button>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-[#1f1b17] group-hover:text-[#8d4b00] transition-colors">
                      {book.title}
                    </h3>
                    <span className="folio-pill-badge uppercase tracking-wider bg-[#f6ece6] text-[#554336] border border-[#e7e5e4] text-[11px] font-semibold shrink-0">
                      {book.user_role}
                    </span>
                  </div>
                  <p className="text-sm text-[#57534e] font-normal mt-2 line-clamp-2 leading-relaxed">
                    Notebook organized by {book.owner_name || "Alice"}.
                  </p>
                </div>

                <div className="flex items-center justify-between mt-5 pt-3 border-t border-[#f0e6e0] text-[#57534e] text-sm">
                  <span className="font-semibold text-[#8d4b00]">
                    {book.total_pages} {book.total_pages === 1 ? "note" : "notes"}
                  </span>
                  <span className="flex items-center gap-1 font-medium">
                    <span className="material-symbols-outlined text-[16px]">schedule</span>
                    Active
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 4. Recent Pages Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#1f1b17] tracking-tight">Recent pages</h2>
          </div>
        </div>

        {/* Calm Editorial Table */}
        <div className="bg-white rounded-xl border border-[#e7e5e4] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fcf2eb] text-[#554336] text-xs uppercase font-bold tracking-wide border-b border-[#e7e5e4]">
                  <th className="py-3 px-4">Page / Title</th>
                  <th className="py-3 px-4 hidden sm:table-cell">Book</th>
                  <th className="py-3 px-4 hidden md:table-cell">Length</th>
                  <th className="py-3 px-4">Path</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f6ece6] text-sm text-[#1f1b17]">
                {recentPages.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-[#78716c] italic">
                      No notes available. Select or create a book to begin writing!
                    </td>
                  </tr>
                ) : (
                  recentPages.map((page) => (
                    <tr
                      key={page.page_id}
                      className="hover:bg-[#fcf2eb]/60 transition-colors group cursor-pointer"
                      onClick={() => onSelectPage(page.page_id)}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <span className="material-symbols-outlined text-[20px] text-[#4b41e1]">
                            article
                          </span>
                          <div>
                            <span className="font-medium text-[#1f1b17] group-hover:text-[#8d4b00] transition-colors flex items-center gap-1">
                              {page.title}
                              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8d4b00] material-symbols-outlined text-[15px]">
                                arrow_outward
                              </span>
                            </span>
                            <span className="text-[#78716c] text-xs block sm:hidden">
                              {page.book_title}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell">
                        <span className="folio-pill-badge bg-[#f6ece6] text-[#554336] border border-[#e7e5e4] gap-1.5 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#d97706]"></span>
                          {page.book_title}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell text-[#57534e] text-sm">
                        <span className="font-mono">~{page.wordCount || 120} words</span>
                      </td>
                      <td className="py-3 px-4 text-[#57534e] text-sm whitespace-nowrap font-mono">
                        {page.breadcrumb || page.slug}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPage(page.page_id);
                          }}
                          className="h-8 px-3.5 rounded-lg bg-[#f0e6e0] hover:bg-[#eae1da] text-[#8d4b00] text-sm font-semibold inline-flex items-center justify-center transition-colors cursor-pointer"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Floating Right-Click Book Context Menu */}
      {bookContextMenu && (
        <div
          id="folio-bookshelf-book-context-menu"
          style={{ top: `${bookContextMenu.y}px`, left: `${bookContextMenu.x}px` }}
          className="fixed z-50 w-56 bg-white/95 backdrop-blur-md border border-[#e7e5e4] shadow-2xl rounded-xl py-1.5 text-xs text-[#1f1b17] animate-scaleUp select-none"
        >
          {/* Header with Book Title */}
          <div className="px-3 py-1.5 border-b border-[#f0e6e0] text-[#78716c] truncate font-semibold text-[11px] flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-[#8d4b00]">menu_book</span>
            <span className="truncate">{bookContextMenu.book.title}</span>
          </div>

          <div className="p-1 space-y-0.5">
            {/* 1. Open Book */}
            <button
              onClick={() => {
                onSelectBook(bookContextMenu.book);
                setBookContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#8d4b00]">menu_book</span>
              <span>Open Book</span>
            </button>

            {/* 2. New Note in Book */}
            <button
              onClick={() => {
                onSelectBook(bookContextMenu.book);
                onCreatePage();
                setBookContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#2563eb]">add_circle</span>
              <span>New Note in Book</span>
            </button>

            {/* 3. Rename Book */}
            <button
              onClick={() => {
                setRenamingBook({ bookId: bookContextMenu.book.book_id, title: bookContextMenu.book.title });
                setBookContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#78716c]">edit</span>
              <span>Rename Book</span>
            </button>

            {/* 4. Copy Book Reference */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(`[[${bookContextMenu.book.title}]]`);
                showToast(`Copied reference for "${bookContextMenu.book.title}"`);
                setBookContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#78716c]">link</span>
              <span>Copy Book Reference</span>
            </button>

            {/* Divider */}
            <div className="h-px bg-[#f0e6e0] my-1" />

            {/* 5. Delete Book */}
            <button
              onClick={() => {
                const b = bookContextMenu.book;
                setBookContextMenu(null);
                if (window.confirm(`Are you sure you want to delete "${b.title}" and all its notes? This action cannot be undone.`)) {
                  if (onDeleteBook) onDeleteBook(b.book_id);
                }
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-red-50 text-red-600 transition-colors cursor-pointer font-semibold"
            >
              <span className="material-symbols-outlined text-[17px] text-red-600">delete</span>
              <span>Delete Book</span>
            </button>
          </div>
        </div>
      )}

      {/* Rename Book Dialog Modal */}
      {renamingBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-[#e7e5e4] shadow-xl max-w-sm w-full p-5 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#1f1b17]">Rename Book</h3>
              <button
                onClick={() => setRenamingBook(null)}
                className="text-[#78716c] hover:text-[#1f1b17] p-1 rounded hover:bg-[#f6ece6] cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (renamingBook.title.trim() && onRenameBook) {
                  onRenameBook(renamingBook.bookId, renamingBook.title.trim());
                  showToast(`Renamed book to "${renamingBook.title.trim()}"`);
                }
                setRenamingBook(null);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-[#554336] mb-1.5">
                  Book Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={renamingBook.title}
                  onChange={(e) =>
                    setRenamingBook({ ...renamingBook, title: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#fcf2eb] border border-[#e7e5e4] text-sm text-[#1f1b17] focus:outline-none focus:border-[#d97706]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRenamingBook(null)}
                  className="px-3.5 py-1.5 rounded-lg text-xs text-[#78716c] hover:bg-[#f6ece6] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#d97706] hover:bg-[#b45309] text-white shadow-xs cursor-pointer"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Action Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-[#1f1b17] text-white px-4 py-2 rounded-full shadow-lg text-xs font-medium flex items-center gap-2 animate-fadeIn pointer-events-none">
          <span className="material-symbols-outlined text-[16px] text-[#fbbf24]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
