import React, { useEffect, useMemo, useRef } from "react";
import type { Book, PageRenderData, PageTreeNode } from "../api";

interface DocumentViewProps {
  pageData: PageRenderData | null;
  book: Book | null;
  pageTree?: PageTreeNode[];
  onSelectBook: (book: Book) => void;
  loading: boolean;
  onToggleInspector: () => void;
  isInspectorOpen: boolean;
  onNavigatePage: (pageId: number) => void;
  onBackToBookshelf: () => void;
  isPinned?: boolean;
  onTogglePin?: (pageId: number) => void;
}

export const DocumentView: React.FC<DocumentViewProps> = ({
  pageData,
  book,
  pageTree = [],
  onSelectBook,
  loading,
  onToggleInspector,
  isInspectorOpen,
  onNavigatePage,
  onBackToBookshelf,
  isPinned = false,
  onTogglePin,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);

  // Compute full ancestral path for breadcrumbs
  const breadcrumbNodes = useMemo(() => {
    if (!pageData || !pageTree || pageTree.length === 0) return [];
    const path: PageTreeNode[] = [];
    let curr = pageTree.find((n) => n.page_id === pageData.page_id);
    while (curr) {
      path.unshift(curr);
      if (!curr.parent_page_id) break;
      curr = pageTree.find((n) => n.page_id === curr?.parent_page_id);
    }
    return path;
  }, [pageData, pageTree]);

  // Intercept wikilink clicks inside the rendered HTML
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest(".folio-wikilink");
      if (target) {
        e.preventDefault();
        const pageIdStr = target.getAttribute("data-page-id");
        if (pageIdStr) {
          const pageId = parseInt(pageIdStr, 10);
          if (!isNaN(pageId)) {
            onNavigatePage(pageId);
          }
        }
      }
    };

    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [pageData, onNavigatePage]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] text-[#78716c] text-sm">
        <div className="w-8 h-8 rounded-full border-2 border-[#d97706] border-t-transparent animate-spin mb-3"></div>
        <span>Loading note...</span>
      </div>
    );
  }

  if (!pageData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] text-center p-8 select-none">
        <div className="w-14 h-14 rounded-2xl bg-[#fcf2eb] border border-[#e7e5e4] flex items-center justify-center text-[#8d4b00] mb-4 shadow-xs">
          <span className="material-symbols-outlined text-[30px]">menu_book</span>
        </div>
        <h2 className="text-xl font-bold text-[#1f1b17]">
          No Note Selected
        </h2>
        <p className="text-xs text-[#78716c] max-w-sm mt-1.5 leading-relaxed">
          Select a note from the outline or return to the Bookshelf to explore your knowledge library.
        </p>
        <button
          onClick={onBackToBookshelf}
          className="mt-4 px-4 py-2 rounded-lg bg-[#d97706] text-white text-xs font-semibold shadow-xs hover:bg-[#b45309] transition-colors cursor-pointer"
        >
          Return to Bookshelf
        </button>
      </div>
    );
  }

  return (
    <div className="w-full animate-fadeIn pb-16">
      {/* 1. Header Toolbar */}
      <div className="flex items-center justify-between pb-4 mb-6 border-b border-[#e7e5e4]">
        {/* Clickable Breadcrumb Path */}
        <div className="flex items-center flex-wrap gap-1.5 text-sm text-[#78716c] min-w-0">
          {book && (
            <button
              onClick={() => onSelectBook(book)}
              className="hover:text-[#8d4b00] font-medium text-sm text-[#44403c] transition-colors cursor-pointer truncate"
              title={`Open ${book.title}`}
            >
              {book.title}
            </button>
          )}

          {breadcrumbNodes.length > 0 ? (
            breadcrumbNodes.map((node, index) => {
              const isLast = index === breadcrumbNodes.length - 1;
              return (
                <React.Fragment key={node.page_id}>
                  <span className="text-[#a8a29e]">/</span>
                  {isLast ? (
                    <span className="truncate text-[#1f1b17] font-semibold text-sm">
                      {node.title}
                    </span>
                  ) : (
                    <button
                      onClick={() => onNavigatePage(node.page_id)}
                      className="hover:text-[#8d4b00] font-medium text-sm text-[#44403c] transition-colors cursor-pointer truncate"
                      title={`Go to ${node.title}`}
                    >
                      {node.title}
                    </button>
                  )}
                </React.Fragment>
              );
            })
          ) : (
            pageData && (
              <>
                <span className="text-[#a8a29e]">/</span>
                <span className="truncate text-[#1f1b17] font-semibold text-sm">
                  {pageData.title}
                </span>
              </>
            )
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Pin / Unpin Button */}
          {pageData && onTogglePin && (
            <button
              onClick={() => onTogglePin(pageData.page_id)}
              title={isPinned ? "Unpin this note" : "Pin this note to sidebar"}
              className={`flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-semibold transition-colors border cursor-pointer ${
                isPinned
                  ? "bg-[#fff7ed] text-[#d97706] border-[#fbd38d]"
                  : "bg-white text-[#44403c] border-[#e7e5e4] hover:bg-[#fcf2eb]"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {isPinned ? "push_pin" : "keep"}
              </span>
              <span className="hidden sm:inline">{isPinned ? "Pinned" : "Pin"}</span>
            </button>
          )}

          {/* Toggle Inspector Drawer */}
          <button
            onClick={onToggleInspector}
            title="Properties & backlinks"
            className={`flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-semibold transition-colors border cursor-pointer ${
              isInspectorOpen
                ? "bg-[#f0e6e0] text-[#8d4b00] border-[#dbc2b0]"
                : "bg-white text-[#44403c] border-[#e7e5e4] hover:bg-[#fcf2eb]"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">dock_to_left</span>
            <span className="hidden sm:inline">Properties</span>
          </button>
        </div>
      </div>

      {/* 2. Floating Paper Document Canvas */}
      <article className="bg-white rounded-2xl border border-[#e7e5e4] shadow-xs p-6 sm:p-12 max-w-4xl mx-auto">
        {/* Document Header Icon */}
        <div className="mb-4">
          <div className="w-12 h-12 rounded-xl bg-[#fcf2eb] border border-[#e7e5e4] flex items-center justify-center text-2xl shadow-xs">
            📄
          </div>
        </div>

        {/* Note Title */}
        <h1 className="text-3xl sm:text-4xl font-bold text-[#1f1b17] tracking-tight mb-3">
          {pageData.title}
        </h1>

        {/* Metadata Strip */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-[#57534e] pb-6 mb-8 border-b border-[#f0e6e0]">
          <span className="flex items-center gap-1 font-mono-editorial">
            <span className="material-symbols-outlined text-[16px]">link</span>
            /{pageData.slug}
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">timer</span>
            ~3 min read
          </span>
        </div>

        {/* Rendered HTML Content (includes live SQL query results and styled tables) */}
        <div
          ref={contentRef}
          className="prose max-w-none text-[#44403C] leading-relaxed text-[15px] space-y-4"
          dangerouslySetInnerHTML={{ __html: pageData.html_content }}
        />
      </article>
    </div>
  );
};
