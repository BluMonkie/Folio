import React, { useState, useEffect, useCallback } from "react";
import {
  api,
  type PublicBookView as PublicBookViewType,
  type PublicPageRender,
  type UserProfile,
} from "../api";

interface PublicBookViewProps {
  shareToken: string;
  currentUser: UserProfile | null;
  onStartEditing: (book: PublicBookViewType) => void;
  onRequireLogin: (book: PublicBookViewType) => void;
  onNavigateHome?: () => void;
}

export const PublicBookView: React.FC<PublicBookViewProps> = ({
  shareToken,
  currentUser,
  onStartEditing,
  onRequireLogin,
  onNavigateHome,
}) => {
  const [publicBook, setPublicBook] = useState<PublicBookViewType | null>(null);
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [pageData, setPageData] = useState<PublicPageRender | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [loadingBook, setLoadingBook] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  // 1. Load Public Book Data & First Page
  const loadBook = useCallback(async () => {
    setLoadingBook(true);
    setError(null);
    try {
      const bookData = await api.getPublicBook(shareToken);
      setPublicBook(bookData);

      if (bookData.tree.length > 0) {
        const firstPageId = bookData.tree[0].page_id;
        setActivePageId(firstPageId);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load published notebook.");
    } finally {
      setLoadingBook(false);
    }
  }, [shareToken]);

  useEffect(() => {
    loadBook();
  }, [loadBook]);

  // 2. Load Selected Page Content
  useEffect(() => {
    if (!activePageId || !shareToken) return;

    const loadPage = async () => {
      setLoadingPage(true);
      try {
        const renderData = await api.getPublicPage(shareToken, activePageId);
        setPageData(renderData);
      } catch (err: any) {
        console.error("Failed to load page render:", err);
      } finally {
        setLoadingPage(false);
      }
    };

    loadPage();
  }, [shareToken, activePageId]);

  const handleSelectPage = (pageId: number) => {
    setActivePageId(pageId);
  };

  const handleEditClick = () => {
    if (!publicBook) return;
    if (currentUser) {
      onStartEditing(publicBook);
    } else {
      onRequireLogin(publicBook);
    }
  };

  if (loadingBook) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#fff8f5] text-[#1f1b17]">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#8d4b00] to-[#b45309] text-white flex items-center justify-center shadow-md animate-pulse mb-3">
          <span className="material-symbols-outlined text-[28px]">menu_book</span>
        </div>
        <div className="text-xs font-semibold text-[#8d4b00] animate-pulse">
          Opening published notebook...
        </div>
      </div>
    );
  }

  if (error || !publicBook) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#fff8f5] p-6 text-center">
        <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-[32px]">link_off</span>
        </div>
        <h2 className="text-xl font-bold text-[#1f1b17] mb-2 font-serif-editorial">
          Notebook Not Found
        </h2>
        <p className="text-sm text-[#554336] max-w-md mb-6 leading-relaxed">
          {error || "This link may have expired or publication has been revoked by the author."}
        </p>
        {onNavigateHome && (
          <button
            onClick={onNavigateHome}
            className="px-5 py-2.5 rounded-lg bg-[#8d4b00] hover:bg-[#703b00] text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Go to Folio Home
          </button>
        )}
      </div>
    );
  }

  // Filter Table of Contents
  const filteredTree = searchFilter.trim()
    ? publicBook.tree.filter((p) =>
        p.title.toLowerCase().includes(searchFilter.toLowerCase())
      )
    : publicBook.tree;

  return (
    <div className="flex h-screen bg-[#fff8f5] text-[#1f1b17] overflow-hidden font-sans">
      {/* 1. Left Table of Contents Collapsible Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-72 bg-[#fcf2eb] border-r border-[#e7e5e4] transition-transform duration-200 ease-in-out flex flex-col justify-between select-none shadow-xs ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Sidebar Header */}
          <div className="h-14 border-b border-[#f0e6e0] px-4 flex items-center justify-between shrink-0 bg-[#f7ebe3]">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="material-symbols-outlined text-[20px] text-[#8d4b00] shrink-0">
                format_list_bulleted
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-[#554336] truncate">
                Table of Contents
              </span>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="p-1.5 rounded-lg text-[#78716c] hover:text-[#1f1b17] hover:bg-[#eae1da] transition-colors cursor-pointer"
              title="Collapse table of contents"
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">left_panel_close</span>
            </button>
          </div>

          {/* Search filter in Table of Contents */}
          <div className="p-3 border-b border-[#f0e6e0]">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#e7e5e4] text-xs">
              <span className="material-symbols-outlined text-[16px] text-[#78716c]">search</span>
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search table of contents..."
                className="bg-transparent border-none outline-none w-full text-xs text-[#1f1b17] placeholder:text-[#a8a29e]"
              />
              {searchFilter && (
                <button
                  onClick={() => setSearchFilter("")}
                  className="text-[#a8a29e] hover:text-[#1f1b17]"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Tree List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
            {filteredTree.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#78716c]">
                No matching notes found.
              </div>
            ) : (
              filteredTree.map((node) => {
                const isSelected = activePageId === node.page_id;
                return (
                  <button
                    key={node.page_id}
                    onClick={() => handleSelectPage(node.page_id)}
                    style={{ paddingLeft: `${node.depth * 14 + 10}px` }}
                    className={`w-full text-left py-2 pr-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-2 cursor-pointer ${
                      isSelected
                        ? "bg-white text-[#8d4b00] font-bold shadow-2xs border border-[#e7e5e4]"
                        : "text-[#554336] hover:bg-[#f0e6e0]"
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-[16px] shrink-0 ${
                        isSelected ? "text-[#d97706]" : "text-[#78716c]"
                      }`}
                    >
                      description
                    </span>
                    <span className="truncate flex-1">{node.title}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Sidebar Footer info */}
        <div className="p-3.5 border-t border-[#f0e6e0] bg-[#f7ebe3] text-[11px] text-[#554336] flex items-center justify-between">
          <span>{publicBook.tree.length} published notes</span>
          <span className="font-semibold text-[#8d4b00]">Folio</span>
        </div>
      </aside>

      {/* 2. Main Content Canvas */}
      <div
        className={`flex-1 flex flex-col h-screen overflow-hidden transition-all duration-200 ${
          isSidebarOpen ? "pl-72" : "pl-0"
        }`}
      >
        {/* Top Header Bar */}
        <header className="h-14 border-b border-[#e7e5e4] px-6 flex items-center justify-between shrink-0 bg-[#fff8f5]/90 backdrop-blur-md z-20">
          {/* Left Context */}
          <div className="flex items-center gap-3 min-w-0">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-1.5 rounded-lg hover:bg-[#f6ece6] text-[#554336] hover:text-[#1f1b17] transition-colors cursor-pointer"
                title="Expand table of contents"
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">left_panel_open</span>
              </button>
            )}

            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-md bg-[#8d4b00] text-white flex items-center justify-center shrink-0 shadow-2xs">
                <span className="material-symbols-outlined text-[16px]">menu_book</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="font-bold text-sm text-[#1f1b17] truncate font-serif-editorial">
                  {publicBook.title}
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-[#f0e6e0] text-[#8d4b00] text-[10px] font-semibold tracking-wide shrink-0">
                  PUBLIC
                </span>
                <span className="text-[11px] text-[#78716c] hidden sm:inline truncate">
                  by {publicBook.owner_name}
                </span>
              </div>
            </div>
          </div>

          {/* Right Action Bar */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* If editable, display the separate "Edit Book" button */}
            {publicBook.access_mode === "EDITOR" && (
              <button
                onClick={handleEditClick}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#d97706] hover:bg-[#b45309] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer group"
                title="Launch the editor dashboard for this notebook"
              >
                <span className="material-symbols-outlined text-[16px]">edit_note</span>
                <span>Edit Book</span>
              </button>
            )}

            {currentUser ? (
              <button
                onClick={onNavigateHome}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f0e6e0] hover:bg-[#eae1da] text-[#1f1b17] text-xs font-semibold transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">dashboard</span>
                <span className="hidden sm:inline">My Bookshelf</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  if (publicBook) onRequireLogin(publicBook);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f0e6e0] hover:bg-[#eae1da] text-[#1f1b17] text-xs font-semibold transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">login</span>
                <span>Sign In</span>
              </button>
            )}
          </div>
        </header>

        {/* Main Rendered Document Area */}
        <main className="flex-1 overflow-y-auto px-6 py-8 sm:px-12 md:px-20 lg:px-28">
          {loadingPage ? (
            <div className="py-20 flex flex-col items-center justify-center gap-2 text-[#78716c]">
              <span className="material-symbols-outlined animate-spin text-[26px] text-[#8d4b00]">
                progress_activity
              </span>
              <span className="text-xs font-medium">Rendering page content...</span>
            </div>
          ) : pageData ? (
            <article className="max-w-3xl mx-auto space-y-6 pb-20 animate-fadeIn">
              {/* Document Meta Header */}
              <div className="border-b border-[#f0e6e0] pb-5 space-y-2.5">
                <div className="flex items-center gap-2 text-xs text-[#78716c]">
                  <span>{publicBook.title}</span>
                  <span>/</span>
                  <span className="text-[#1f1b17] font-medium truncate">{pageData.title}</span>
                </div>

                <h1 className="text-3xl sm:text-4xl font-normal text-[#1f1b17] tracking-tight font-serif-editorial">
                  {pageData.title}
                </h1>

                {/* Tags Strip */}
                {pageData.tags && pageData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {pageData.tags.map((t) => (
                      <span
                        key={t.tag_id}
                        className="px-2 py-0.5 rounded-md bg-[#f0e6e0] text-[#8d4b00] text-xs font-medium"
                      >
                        #{t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Rendered HTML Markdown & Interactive SQL Tables */}
              <div
                className="prose prose-stone max-w-none folio-rendered-content text-[#1f1b17] leading-relaxed text-[15px]"
                dangerouslySetInnerHTML={{ __html: pageData.html_content }}
              />

              {/* Backlinks Section */}
              {pageData.backlinks && pageData.backlinks.length > 0 && (
                <div className="mt-12 pt-6 border-t border-[#f0e6e0] space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#554336]">
                    <span className="material-symbols-outlined text-[16px] text-[#8d4b00]">link</span>
                    <span>Linked References ({pageData.backlinks.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {pageData.backlinks.map((bl) => (
                      <button
                        key={bl.page_id}
                        onClick={() => handleSelectPage(bl.page_id)}
                        className="p-3 rounded-xl border border-[#e7e5e4] bg-[#fcf2eb] hover:bg-white text-left transition-colors cursor-pointer group"
                      >
                        <div className="text-xs font-bold text-[#1f1b17] group-hover:text-[#8d4b00] flex items-center justify-between">
                          <span>{bl.title}</span>
                          <span className="material-symbols-outlined text-[14px] opacity-0 group-hover:opacity-100 transition-opacity">
                            arrow_forward
                          </span>
                        </div>
                        <span className="text-[11px] text-[#78716c]">Click to navigate</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ) : (
            <div className="py-20 text-center text-[#78716c] text-sm">
              Select a note from the table of contents to start reading.
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
