import React, { useState, useEffect, useCallback } from "react";
import type { 
  Book, 
  PageTreeNode, 
  PageRenderData, 
  UserProfile, 
  PageGrantItem, 
  BacklinkItem, 
  EditHistoryItem, 
  TagItem 
} from "./api";
import { api, getToken } from "./api";
import { Sidebar, type PinnedPageItem } from "./components/Sidebar";
import { Bookshelf } from "./components/Bookshelf";
import { DocumentView } from "./components/DocumentView";
import { Inspector } from "./components/Inspector";
import { SearchModal } from "./components/SearchModal";
import { AuthScreen } from "./components/AuthScreen";
import { UserAccountMenu } from "./components/UserAccountMenu";
import { DataStudio } from "./components/DataStudio";
import { BookGrantsModal } from "./components/BookGrantsModal";

interface RecentPageItem {
  page_id: number;
  book_id: number;
  book_title: string;
  title: string;
  slug: string;
  breadcrumb?: string;
  wordCount?: number;
}

export function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [selectedSidebarBook, setSelectedSidebarBook] = useState<Book | null>(null);
  const [pageTree, setPageTree] = useState<PageTreeNode[]>([]);
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [pageData, setPageData] = useState<PageRenderData | null>(null);
  const [recentPages, setRecentPages] = useState<RecentPageItem[]>([]);
  const [pinnedPages, setPinnedPages] = useState<PinnedPageItem[]>([]);
  
  // Navigation View State: 'bookshelf', 'document', or 'data'
  const [activeView, setActiveView] = useState<"bookshelf" | "document" | "data">("bookshelf");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [managingGrantsBook, setManagingGrantsBook] = useState<Book | null>(null);

  // Inspector Drawer State
  const [grants, setGrants] = useState<PageGrantItem[]>([]);
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [history, setHistory] = useState<EditHistoryItem[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"grants" | "backlinks" | "history" | "tags">("grants");

  // Search & Modal State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [isCreateBookOpen, setIsCreateBookOpen] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState("");

  // 1. Load Books & Gather Recent Pages
  const loadBooks = useCallback(async () => {
    try {
      const list = await api.listBooks();
      setBooks(list);
      if (list.length > 0) {
        setActiveBook(list[0]);
      }

      // Collect recent pages from trees
      const collected: RecentPageItem[] = [];
      for (const b of list) {
        try {
          const tree = await api.getBookTree(b.book_id);
          for (const node of tree) {
            collected.push({
              page_id: node.page_id,
              book_id: b.book_id,
              book_title: b.title,
              title: node.title,
              slug: node.slug,
              breadcrumb: node.breadcrumb,
              wordCount: Math.floor(180 + (node.title.length * 37) % 600),
            });
          }
        } catch {
          // ignore individual tree errors
        }
      }
      setRecentPages(collected);
    } catch (err) {
      console.error("Failed to load books:", err);
    }
  }, []);

  // 2. Authentication Initialization (Restore existing session or prompt for login)
  useEffect(() => {
    const initAuth = async () => {
      const token = getToken();
      if (token) {
        try {
          const user = await api.getMe();
          setCurrentUser(user);
          await loadBooks();
        } catch (err) {
          console.error("Session verification failed, logging out:", err);
          api.logout();
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }
      setAuthChecking(false);
    };

    initAuth();
  }, [loadBooks]);

  // Handle successful login or signup from AuthScreen
  const handleAuthSuccess = async (user: UserProfile) => {
    setCurrentUser(user);
    await loadBooks();
  };

  // Handle User Log Out
  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    setBooks([]);
    setActiveBook(null);
    setSelectedSidebarBook(null);
    setPageTree([]);
    setActivePageId(null);
    setPageData(null);
    setRecentPages([]);
    setPinnedPages([]);
    setActiveView("bookshelf");
  };

  // Global ⌘K / Ctrl+K & ⌘N / Ctrl+N listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleCreateQuickNote();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 3. Load Page Tree when activeBook changes
  useEffect(() => {
    if (!activeBook) return;

    const loadTree = async () => {
      try {
        const tree = await api.getBookTree(activeBook.book_id);
        setPageTree(tree);
        if (tree.length > 0 && !activePageId) {
          setActivePageId(tree[0].page_id);
        }
      } catch (err) {
        console.error("Failed to load page tree:", err);
      }
    };

    loadTree();
  }, [activeBook]);

  // 4. Load Active Page Data & Inspector Subsystems
  useEffect(() => {
    if (!activePageId) {
      setPageData(null);
      return;
    }

    const loadPageDetails = async () => {
      setLoadingPage(true);
      try {
        const render = await api.getPageRender(activePageId);
        setPageData(render);

        // Fetch inspector metadata in parallel
        const [gList, bList, hList, tList] = await Promise.all([
          api.getPageGrants(activePageId).catch(() => []),
          api.getPageBacklinks(activePageId).catch(() => []),
          api.getPageHistory(activePageId).catch(() => []),
          api.getPageTags(activePageId).catch(() => []),
        ]);

        setGrants(gList);
        setBacklinks(bList);
        setHistory(hList);
        setTags(tList);
      } catch (err) {
        console.error("Failed to load page render:", err);
      } finally {
        setLoadingPage(false);
      }
    };

    loadPageDetails();
  }, [activePageId]);

  // Handler: Select a book
  const handleSelectBook = (book: Book, openFirstPage: boolean = true) => {
    setActiveBook(book);
    setSelectedSidebarBook(book);
    setIsSidebarOpen(true);
    api.getBookTree(book.book_id).then((tree) => {
      setPageTree(tree);
      if (tree.length > 0 && openFirstPage) {
        handleSelectPage(tree[0].page_id);
      }
    });
  };

  // Handler: Select a page and jump to Document View
  const handleSelectPage = (pageId: number) => {
    setActivePageId(pageId);
    setActiveView("document");
  };

  // Handler: Pin / unpin note to sidebar
  const handleTogglePin = (pageId: number) => {
    setPinnedPages((prev) => {
      const exists = prev.some((p) => p.page_id === pageId);
      if (exists) {
        return prev.filter((p) => p.page_id !== pageId);
      }
      const foundNode = pageTree.find((n) => n.page_id === pageId);
      const foundRecent = recentPages.find((r) => r.page_id === pageId);
      const title = foundNode?.title || foundRecent?.title || `Note #${pageId}`;
      return [...prev, { page_id: pageId, title, book_id: activeBook?.book_id }];
    });
  };

  // Handler: Unpin specific page
  const handleUnpinPage = (pageId: number) => {
    setPinnedPages((prev) => prev.filter((p) => p.page_id !== pageId));
  };

  // Handler: Close all pinned pages
  const handleCloseAllPinned = () => {
    setPinnedPages([]);
  };

  // Handler: Create Page
  const handleCreatePage = async (title: string, parentId?: number | null) => {
    if (!activeBook) return;
    try {
      const created = await api.createPage(activeBook.book_id, {
        title,
        parent_page_id: parentId,
        content: `# ${title}\n\nStart writing your thoughts, notes, and ideas here...`,
      });
      const updatedTree = await api.getBookTree(activeBook.book_id);
      setPageTree(updatedTree);
      handleSelectPage(created.page_id);
      loadBooks();
    } catch (err) {
      alert(`Error creating page: ${err}`);
    }
  };

  // Handler: Move / Reorder Page
  const handleMovePage = async (
    pageId: number,
    targetPageId: number | null,
    dropPosition: "before" | "after" | "inside"
  ) => {
    const book = activeBook || selectedSidebarBook;
    if (!book) return;
    try {
      await api.movePage(pageId, {
        target_page_id: targetPageId,
        drop_position: dropPosition,
      });
      const updatedTree = await api.getBookTree(book.book_id);
      setPageTree(updatedTree);
    } catch (err) {
      alert(`Error moving page: ${err}`);
    }
  };

  // Handler: Delete Page
  const handleDeletePage = async (pageId: number) => {
    const targetNode = pageTree.find((n) => n.page_id === pageId);
    const title = targetNode?.title || `Note #${pageId}`;
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;

    try {
      await api.deletePage(pageId);
      const book = activeBook || selectedSidebarBook;
      if (book) {
        const updatedTree = await api.getBookTree(book.book_id);
        setPageTree(updatedTree);
        if (activePageId === pageId) {
          if (updatedTree.length > 0) {
            handleSelectPage(updatedTree[0].page_id);
          } else {
            setActivePageId(null);
            setPageData(null);
          }
        }
      }
      handleUnpinPage(pageId);
      loadBooks();
    } catch (err) {
      alert(`Failed to delete note: ${err}`);
    }
  };

  // Handler: Rename Page
  const handleRenamePage = async (pageId: number, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      await api.updatePage(pageId, { title: newTitle.trim() });
      const book = activeBook || selectedSidebarBook;
      if (book) {
        const updatedTree = await api.getBookTree(book.book_id);
        setPageTree(updatedTree);
        if (activePageId === pageId) {
          const render = await api.getPageRender(pageId);
          setPageData(render);
        }
      }
      setPinnedPages((prev) =>
        prev.map((p) => (p.page_id === pageId ? { ...p, title: newTitle.trim() } : p))
      );
    } catch (err) {
      alert(`Failed to rename note: ${err}`);
    }
  };

  // Handler: Open specific inspector tab for a page
  const handleOpenInspectorTab = (pageId: number, tab: "grants" | "backlinks" | "history" | "tags") => {
    handleSelectPage(pageId);
    setInspectorTab(tab);
    setIsInspectorOpen(true);
  };

  const handleCreateQuickNote = () => {
    const title = prompt("Enter Quick Note Title:", "Untitled Note");
    if (title && title.trim()) {
      handleCreatePage(title.trim(), null);
    }
  };

  // Handler: Delete Book
  const handleDeleteBook = async (bookId: number) => {
    const targetBook = books.find((b) => b.book_id === bookId);
    const title = targetBook?.title || `Book #${bookId}`;
    if (!confirm(`Are you sure you want to delete book "${title}"? All notes within it will be permanently deleted.`)) return;

    try {
      await api.deleteBook(bookId);
      if (activeBook?.book_id === bookId) {
        setActiveBook(null);
        setSelectedSidebarBook(null);
        setActivePageId(null);
        setPageTree([]);
        setPageData(null);
        setActiveView("bookshelf");
      } else if (selectedSidebarBook?.book_id === bookId) {
        setSelectedSidebarBook(null);
      }
      await loadBooks();
    } catch (err) {
      alert(`Failed to delete book: ${err}`);
    }
  };

  // Handler: Rename Book
  const handleRenameBook = async (bookId: number, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      const updated = await api.updateBook(bookId, { title: newTitle.trim() });
      if (activeBook?.book_id === bookId) {
        setActiveBook(updated);
      }
      if (selectedSidebarBook?.book_id === bookId) {
        setSelectedSidebarBook(updated);
      }
      await loadBooks();
    } catch (err) {
      alert(`Failed to rename book: ${err}`);
    }
  };

  // Handler: Save Page Markdown Content
  const handleSavePageContent = async (pageId: number, content: string) => {
    try {
      await api.updatePage(pageId, { content });
      const updatedRender = await api.getPageRender(pageId);
      setPageData(updatedRender);

      // Refresh inspector metadata (backlinks, history)
      const [bList, hList] = await Promise.all([
        api.getPageBacklinks(pageId).catch(() => []),
        api.getPageHistory(pageId).catch(() => []),
      ]);
      setBacklinks(bList);
      setHistory(hList);
    } catch (err: any) {
      console.error("Failed to save note content:", err);
      throw err;
    }
  };

  // Handler: Create Book
  const handleCreateBookSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBookTitle.trim()) return;
    try {
      const created = await api.createBook(newBookTitle.trim());
      setNewBookTitle("");
      setIsCreateBookOpen(false);
      await loadBooks();
      setActiveBook(created);
    } catch (err) {
      alert(`Error creating book: ${err}`);
    }
  };

  // Render Auth Checking Splash
  if (authChecking) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#fdf9f6] text-[#1f1b17]">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#8d4b00] to-[#b45309] text-white flex items-center justify-center shadow-md animate-pulse mb-3">
          <span className="material-symbols-outlined text-[24px]">menu_book</span>
        </div>
        <div className="text-xs font-semibold text-[#8d4b00] animate-pulse">Loading Folio...</div>
      </div>
    );
  }

  // Render Login / Signup Screen if user is not authenticated
  if (!currentUser) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="flex h-screen bg-[#fff8f5] text-[#1f1b17] overflow-hidden font-sans">
      {/* 1. Left Editorial Sidebar */}
      <Sidebar
        books={books}
        selectedBook={selectedSidebarBook}
        onSelectBook={handleSelectBook}
        onBackFromBook={() => setSelectedSidebarBook(null)}
        pageTree={pageTree}
        activePageId={activePageId}
        onSelectPage={handleSelectPage}
        onMovePage={handleMovePage}
        onDeletePage={handleDeletePage}
        onRenamePage={handleRenamePage}
        onOpenInspectorTab={handleOpenInspectorTab}
        onDeleteBook={handleDeleteBook}
        onRenameBook={handleRenameBook}
        pinnedPages={pinnedPages}
        onTogglePin={handleTogglePin}
        onUnpinPage={handleUnpinPage}
        onCloseAllPinned={handleCloseAllPinned}
        activeView={activeView}
        onChangeView={(view) => setActiveView(view)}
        onManageBookGrants={(book) => setManagingGrantsBook(book)}
        onCreatePage={handleCreatePage}
        onCreateBook={() => setIsCreateBookOpen(true)}
        isOpen={isSidebarOpen}
        onToggleOpen={() => setIsSidebarOpen((prev) => !prev)}
      />

      {/* 2. Main Workspace Canvas Container */}
      <div
        className={`flex-1 flex flex-col h-screen overflow-hidden transition-all duration-200 ${
          isSidebarOpen ? "pl-72" : "pl-0"
        }`}
      >
        {/* Top Header Bar */}
        <header className="h-14 border-b border-[#e7e5e4] px-6 flex items-center justify-between shrink-0 bg-[#fff8f5]/90 backdrop-blur-md z-10">
          {/* Left Context & Mobile/Collapse Sidebar Opener */}
          <div className="flex items-center gap-3 min-w-0">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-1.5 rounded-lg hover:bg-[#f6ece6] text-[#554336] hover:text-[#1f1b17] transition-colors cursor-pointer"
                title="Expand sidebar"
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">left_panel_open</span>
              </button>
            )}

            {/* Top Bar Title */}
            <div className="flex items-center min-w-0">
              <span className="font-semibold text-base text-[#1f1b17] truncate">
                {activeView === "bookshelf"
                  ? "Bookshelf & Library"
                  : activeView === "data"
                  ? "Data Explorer & Tables"
                  : activeBook?.title || "Document View"}
              </span>
            </div>
          </div>

          {/* Minimalist Search Bar (Single Search across app) */}
          <div
            onClick={() => setIsSearchOpen(true)}
            className="hidden md:flex items-center gap-2 h-9 px-3.5 rounded-full bg-white hover:bg-[#fcf2eb] border border-[#e7e5e4] transition-colors w-72 text-[#57534e] shadow-2xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-[17px] text-[#887364]">search</span>
            <span className="text-xs flex-1 truncate font-normal">Search notes...</span>
            <kbd className="folio-kbd-badge bg-[#f6ece6] text-[#554336] border border-[#e7e5e4]">
              ⌘K
            </kbd>
          </div>

          {/* Action Icons */}
          <div className="flex items-center gap-1.5">
            {/* Quick Data Tables button */}
            <button
              type="button"
              onClick={() => setActiveView(activeView === "data" ? "bookshelf" : "data")}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeView === "data"
                  ? "bg-[#8d4b00] text-white shadow-xs"
                  : "bg-[#f0e6e0] hover:bg-[#eae1da] text-[#554336]"
              }`}
              title="Toggle Data Explorer & MySQL Tables"
            >
              <span className="material-symbols-outlined text-[16px]">dataset</span>
              <span className="hidden sm:inline">Data Tables</span>
            </button>

            {activeView === "document" ? (
              <>
                <button
                  onClick={() => setActiveView("bookshelf")}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-[#f6ece6] text-[#554336] text-xs font-medium transition-colors cursor-pointer"
                  title="Return to Bookshelf view"
                >
                  <span className="material-symbols-outlined text-[16px]">dashboard</span>
                  <span className="hidden sm:inline">Bookshelf</span>
                </button>
                <button
                  onClick={() => setIsInspectorOpen((prev) => !prev)}
                  title="Toggle Inspector Drawer"
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    isInspectorOpen
                      ? "bg-[#f0e6e0] text-[#8d4b00]"
                      : "text-[#554336] hover:bg-[#f6ece6]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">dock_to_left</span>
                </button>
              </>
            ) : activeView === "bookshelf" ? (
              <button
                onClick={() => {
                  if (activePageId) setActiveView("document");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f0e6e0] hover:bg-[#eae1da] text-[#8d4b00] text-xs font-semibold transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">article</span>
                <span>Open Current Note</span>
              </button>
            ) : (
              <button
                onClick={() => setActiveView("bookshelf")}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-[#f6ece6] text-[#554336] text-xs font-medium transition-colors cursor-pointer"
                title="Return to Bookshelf view"
              >
                <span className="material-symbols-outlined text-[16px]">dashboard</span>
                <span>Bookshelf</span>
              </button>
            )}

            <div className="w-px h-5 bg-[#e7e5e4] mx-1" />

            {/* Top Right Accounts Button with hover user info & logout */}
            <UserAccountMenu user={currentUser} onLogout={handleLogout} />
          </div>
        </header>

        {/* Dynamic Body Canvas Slot */}
        <div className={`flex-1 overflow-hidden ${activeView === "data" ? "p-0" : "overflow-y-auto px-6 sm:px-10 py-6"}`}>
          {activeView === "data" ? (
            <DataStudio onBackToBookshelf={() => setActiveView("bookshelf")} />
          ) : (
            <div className="max-w-5xl mx-auto">
              {activeView === "bookshelf" ? (
                <Bookshelf
                  currentUser={currentUser}
                  books={books}
                  recentPages={recentPages}
                  onSelectBook={(book) => {
                    handleSelectBook(book);
                    setActiveView("document");
                  }}
                  onSelectPage={handleSelectPage}
                  onCreateBook={() => setIsCreateBookOpen(true)}
                  onCreatePage={handleCreateQuickNote}
                  onDeleteBook={handleDeleteBook}
                  onRenameBook={handleRenameBook}
                />
              ) : (
                <DocumentView
                  pageData={pageData}
                  book={activeBook}
                  pageTree={pageTree}
                  onSelectBook={handleSelectBook}
                  loading={loadingPage}
                  isInspectorOpen={isInspectorOpen}
                  onToggleInspector={() => setIsInspectorOpen((prev) => !prev)}
                  onNavigatePage={handleSelectPage}
                  onBackToBookshelf={() => setActiveView("bookshelf")}
                  isPinned={Boolean(activePageId && pinnedPages.some((p) => p.page_id === activePageId))}
                  onTogglePin={handleTogglePin}
                  onSaveContent={handleSavePageContent}
                  tags={tags}
                  onOpenTags={() => {
                    if (activePageId) {
                      handleOpenInspectorTab(activePageId, "tags");
                    }
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. Right Context Inspector Drawer */}
      <Inspector
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        grants={grants}
        backlinks={backlinks}
        history={history}
        tags={tags}
        onNavigatePage={handleSelectPage}
        tab={inspectorTab}
        onTabChange={setInspectorTab}
        activePageId={activePageId}
        onGrantsUpdated={async () => {
          if (activePageId) {
            const gList = await api.getPageGrants(activePageId).catch(() => []);
            setGrants(gList);
          }
        }}
        onTagsUpdated={async () => {
          if (activePageId) {
            const tList = await api.getPageTags(activePageId).catch(() => []);
            setTags(tList);
          }
        }}
        onHistoryRestored={async (restoredPageId: number) => {
          try {
            const [render, hList, bList] = await Promise.all([
              api.getPageRender(restoredPageId),
              api.getPageHistory(restoredPageId).catch(() => []),
              api.getPageBacklinks(restoredPageId).catch(() => []),
            ]);
            setPageData(render);
            setHistory(hList);
            setBacklinks(bList);
          } catch (err) {
            console.error("Failed to refresh restored page:", err);
          }
        }}
      />

      {/* 4. Global Command Search Modal (⌘K) */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectPage={handleSelectPage}
      />

      {/* 5. Create Book Modal Dialog */}
      {isCreateBookOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-[#e7e5e4] shadow-xl max-w-sm w-full p-6 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-serif-editorial font-semibold text-[#1f1b17]">
                Create New Book
              </h3>
              <button
                onClick={() => setIsCreateBookOpen(false)}
                className="text-[#78716c] hover:text-[#1f1b17]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateBookSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#554336] mb-1">
                  Book Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newBookTitle}
                  onChange={(e) => setNewBookTitle(e.target.value)}
                  placeholder="e.g. Distributed Systems"
                  className="w-full px-3 py-2 rounded-lg bg-[#fcf2eb] border border-[#e7e5e4] text-sm text-[#1f1b17] focus:outline-none focus:border-[#d97706]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateBookOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg text-xs text-[#78716c] hover:bg-[#f6ece6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#d97706] hover:bg-[#b45309] text-white shadow-xs"
                >
                  Create Book
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Book Data Grants Modal Dialog */}
      {managingGrantsBook && (
        <BookGrantsModal
          book={managingGrantsBook}
          onClose={() => setManagingGrantsBook(null)}
          onUpdated={async () => {
            if (activePageId) {
              const gList = await api.getPageGrants(activePageId).catch(() => []);
              setGrants(gList);
            }
          }}
        />
      )}
    </div>
  );
}

export default App;
