import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Book, PageRenderData, PageTreeNode, TagItem } from "../api";
import { VisualEditor } from "./VisualEditor";
import { SplitEditor } from "./SplitEditor";

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
  onSaveContent?: (pageId: number, content: string) => Promise<void>;
  tags?: TagItem[];
  onOpenTags?: () => void;
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
  onSaveContent,
  tags = [],
  onOpenTags,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);

  // Editor mode: "read" (reading view) | "visual" (Typora-style visual editor) | "split" (CodeMirror + live preview)
  const [editorMode, setEditorMode] = useState<"read" | "visual" | "split">("read");

  // Single canonical markdown state synced across both editor modes
  const [canonicalMarkdown, setCanonicalMarkdown] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 2500);
  };

  // Sync canonical markdown whenever pageData changes
  useEffect(() => {
    if (pageData) {
      setCanonicalMarkdown(pageData.raw_content || "");
    } else {
      setCanonicalMarkdown("");
    }
  }, [pageData?.page_id, pageData?.raw_content]);

  // Track if content has been modified compared to persisted raw_content
  const isDirty = useMemo(() => {
    if (!pageData) return false;
    return canonicalMarkdown !== (pageData.raw_content || "");
  }, [canonicalMarkdown, pageData]);

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
  }, [pageData, onNavigatePage, editorMode]);

  // Save handler (ONLY saves, keeps user in editor)
  const handleSave = async () => {
    if (!pageData || !onSaveContent || !isDirty || isSaving) return;
    setIsSaving(true);
    try {
      const cleanMd = canonicalMarkdown.replace(/\\\[\\\[/g, "[[").replace(/\\\]\\\]/g, "]]");
      await onSaveContent(pageData.page_id, cleanMd);
      showToast("Note saved");
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Discard handler (reverts content and disables editor)
  const handleDiscard = () => {
    setCanonicalMarkdown(pageData?.raw_content || "");
    setEditorMode("read");
  };

  // Exit Editing handler (disables editor, prompts if unsaved)
  const handleExitEditing = () => {
    if (isDirty) {
      if (window.confirm("You have unsaved changes. Discard changes and exit editing?")) {
        setCanonicalMarkdown(pageData?.raw_content || "");
        setEditorMode("read");
      }
    } else {
      setEditorMode("read");
    }
  };

  // Global keyboard shortcuts: ⌘S to save, ⌘E to toggle edit mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setEditorMode((prev) => (prev === "read" ? "visual" : "read"));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

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
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-6 border-b border-[#e7e5e4]">
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

        {/* Central Controls: Mode Switcher & Save Action */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Editor Switcher Tabs - Only visible while editing is active */}
          {editorMode !== "read" ? (
            <div className="flex items-center p-0.5 bg-[#f0e6e0] rounded-xl border border-[#e7e5e4] text-xs font-semibold">
              <button
                type="button"
                onClick={() => setEditorMode("visual")}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  editorMode === "visual"
                    ? "bg-white text-[#8d4b00] shadow-2xs font-semibold"
                    : "text-[#554336] hover:text-[#1f1b17]"
                }`}
                title="Visual Editor"
              >
                Visual
              </button>
              <button
                type="button"
                onClick={() => setEditorMode("split")}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  editorMode === "split"
                    ? "bg-white text-[#8d4b00] shadow-2xs font-semibold"
                    : "text-[#554336] hover:text-[#1f1b17]"
                }`}
                title="Split Editor"
              >
                Split
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditorMode("visual")}
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold bg-[#fcf2eb] hover:bg-[#f6ece6] border border-[#e7e5e4] text-[#8d4b00] shadow-2xs transition-colors cursor-pointer"
              title="Edit Note (Ctrl+E)"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
              <span>Edit Note</span>
            </button>
          )}

          {/* Editing Mode Actions */}
          {editorMode !== "read" && (
            <div className="flex items-center gap-1.5">
              {isDirty && (
                <span className="flex items-center gap-1.5 text-xs text-[#d97706] font-semibold bg-[#fff8f2] px-2.5 py-1 rounded-full border border-[#fbd38d]/70 mr-0.5">
                  <span className="w-2 h-2 rounded-full bg-[#d97706] animate-pulse"></span>
                  Unsaved
                </span>
              )}
              {/* Save Button (ONLY saves, keeps user in editor) */}
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !isDirty}
                className={`flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer ${
                  isDirty
                    ? "bg-[#d97706] hover:bg-[#b45309] text-white"
                    : "bg-[#f6ece6] text-[#78716c] cursor-not-allowed opacity-70"
                }`}
                title="Save note (Ctrl+S / Cmd+S)"
              >
                {isSaving ? (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <span className="material-symbols-outlined text-[16px]">save</span>
                )}
                <span>Save</span>
              </button>

              {/* Discard Button (reverts changes and disables editor) */}
              {isDirty && (
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="h-8 px-3 rounded-lg text-xs font-semibold text-[#78716c] hover:text-red-700 hover:bg-red-50 border border-[#e7e5e4] transition-colors cursor-pointer"
                  title="Discard changes and exit editing"
                >
                  Discard
                </button>
              )}

              {/* Exit Editing Button (disables editor) */}
              <button
                type="button"
                onClick={handleExitEditing}
                className="flex items-center gap-1 h-8 px-3 rounded-lg text-xs font-semibold text-[#554336] hover:text-[#1f1b17] hover:bg-[#eae1da] border border-[#e7e5e4] transition-colors cursor-pointer"
                title="Exit editing mode and return to reading view"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
                <span>Exit Editing</span>
              </button>
            </div>
          )}

          <div className="w-px h-6 bg-[#e7e5e4] mx-0.5 hidden sm:block" />

          {/* Pin / Unpin Button */}
          {pageData && onTogglePin && (
            <button
              onClick={() => onTogglePin(pageData.page_id)}
              title={isPinned ? "Unpin this note" : "Pin this note to sidebar"}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors border cursor-pointer ${
                isPinned
                  ? "bg-[#fff7ed] text-[#d97706] border-[#fbd38d]"
                  : "bg-white text-[#44403c] border-[#e7e5e4] hover:bg-[#fcf2eb]"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {isPinned ? "push_pin" : "keep"}
              </span>
              <span className="hidden sm:inline">{isPinned ? "Pinned" : "Pin"}</span>
            </button>
          )}

          {/* Toggle Inspector Drawer */}
          <button
            onClick={onToggleInspector}
            title="Properties, SQL Grants & Backlinks"
            className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors border cursor-pointer ${
              isInspectorOpen
                ? "bg-[#f0e6e0] text-[#8d4b00] border-[#dbc2b0]"
                : "bg-white text-[#44403c] border-[#e7e5e4] hover:bg-[#fcf2eb]"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">dock_to_left</span>
            <span className="hidden sm:inline">Properties</span>
          </button>
        </div>
      </div>

      {/* 2. Main Canvas Body */}
      {editorMode === "visual" ? (
        /* Mode 1: Visual Editor */
        <div className="max-w-4xl mx-auto">
          <VisualEditor
            content={canonicalMarkdown}
            onChange={(val) => setCanonicalMarkdown(val)}
            onSave={handleSave}
          />
        </div>
      ) : editorMode === "split" ? (
        /* Mode 2: Split-Pane Editor */
        <div className="max-w-6xl mx-auto">
          <SplitEditor
            content={canonicalMarkdown}
            onChange={(val) => setCanonicalMarkdown(val)}
            renderedHtml={pageData.html_content}
            savedContent={pageData.raw_content || ""}
            onSave={handleSave}
            onNavigatePage={onNavigatePage}
          />
        </div>
      ) : (
        /* Default: Reading Mode (Warm Paper Document) */
        <article className="bg-white rounded-2xl border border-[#e7e5e4] shadow-xs p-6 sm:p-12 max-w-4xl mx-auto">
          {/* Document Header Icon & Edit shortcut button */}
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-xl bg-[#fcf2eb] border border-[#e7e5e4] flex items-center justify-center text-2xl shadow-xs">
              📄
            </div>
            <button
              type="button"
              onClick={() => setEditorMode("visual")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#fcf2eb] hover:bg-[#f6ece6] border border-[#e7e5e4] text-[#8d4b00] text-xs font-semibold transition-colors cursor-pointer"
              title="Edit this note (Ctrl+E)"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
              <span>Edit Note</span>
            </button>
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

            {/* Note Tags Pills */}
            {tags.length > 0 ? (
              <>
                <span>•</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((t) => (
                    <button
                      key={t.tag_id}
                      type="button"
                      onClick={onOpenTags}
                      className="folio-pill-badge bg-[#fcf2eb] hover:bg-[#f6ece6] text-[#006a61] border border-[#e7e5e4] !h-5.5 !px-2 text-xs font-medium cursor-pointer transition-colors"
                      title="Manage note tags in Inspector"
                    >
                      #{t.name}
                    </button>
                  ))}
                  {onOpenTags && (
                    <button
                      type="button"
                      onClick={onOpenTags}
                      className="text-xs text-[#8d4b00] hover:underline cursor-pointer font-medium px-1"
                      title="Add or edit tags"
                    >
                      +
                    </button>
                  )}
                </div>
              </>
            ) : (
              onOpenTags && (
                <>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={onOpenTags}
                    className="inline-flex items-center gap-1 text-xs text-[#78716c] hover:text-[#8d4b00] cursor-pointer transition-colors"
                    title="Add tags to this note"
                  >
                    <span className="material-symbols-outlined text-[14px]">label</span>
                    <span>Add tags</span>
                  </button>
                </>
              )
            )}
          </div>

          {/* Rendered HTML Content (includes live SQL query results and styled tables) */}
          <div
            ref={contentRef}
            className="prose max-w-none text-[#44403C] leading-relaxed text-[15px] space-y-4"
            dangerouslySetInnerHTML={{ __html: pageData.html_content }}
          />
        </article>
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
