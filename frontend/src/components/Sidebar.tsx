import React, { useState, useMemo, useEffect } from "react";
import { downloadBookExport, type Book, type PageTreeNode } from "../api";

export interface PinnedPageItem {
  page_id: number;
  title: string;
  book_id?: number;
}

interface SidebarProps {
  books: Book[];
  selectedBook: Book | null;
  onSelectBook: (book: Book) => void;
  onBackFromBook: () => void;
  pageTree: PageTreeNode[];
  activePageId: number | null;
  onSelectPage: (pageId: number) => void;
  onMovePage?: (
    draggedPageId: number,
    targetPageId: number | null,
    dropPosition: "before" | "after" | "inside"
  ) => void;
  onDeletePage?: (pageId: number) => void;
  onRenamePage?: (pageId: number, newTitle: string) => void;
  onOpenInspectorTab?: (pageId: number, tab: "grants" | "backlinks" | "history" | "tags") => void;
  onDeleteBook?: (bookId: number) => void;
  onRenameBook?: (bookId: number, newTitle: string) => void;
  pinnedPages: PinnedPageItem[];
  onTogglePin?: (pageId: number) => void;
  onUnpinPage: (pageId: number) => void;
  onCloseAllPinned: () => void;
  activeView: "bookshelf" | "document" | "data";
  onChangeView: (view: "bookshelf" | "document" | "data") => void;
  onManageBookGrants?: (book: Book) => void;
  onCreatePage: (title: string, parentId?: number | null) => void;
  onCreateBook: () => void;
  onPublishBook?: (book: Book) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  sharedBook?: Book | null;
}

interface ContextMenuState {
  x: number;
  y: number;
  pageId: number;
  pageTitle: string;
  isPinned: boolean;
}

interface BookContextMenuState {
  x: number;
  y: number;
  book: Book;
}

export const Sidebar: React.FC<SidebarProps> = ({
  books = [],
  selectedBook,
  onSelectBook,
  onBackFromBook,
  pageTree = [],
  activePageId,
  onSelectPage,
  onMovePage,
  onDeletePage,
  onRenamePage,
  onOpenInspectorTab,
  onDeleteBook,
  onRenameBook,
  pinnedPages = [],
  onTogglePin,
  onUnpinPage,
  onCloseAllPinned,
  activeView,
  onChangeView,
  onManageBookGrants,
  onCreatePage,
  onCreateBook,
  onPublishBook,
  isOpen,
  onToggleOpen,
  sharedBook,
}) => {
  // Modal state
  const [isNewPageModalOpen, setIsNewPageModalOpen] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState("");
  const [targetParentForNewPage, setTargetParentForNewPage] = useState<number | null>(null);
  const [createLocation, setCreateLocation] = useState<"child" | "root">("child");

  // Collapsible tree state: set of page_ids that are collapsed
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());

  // Drag-and-drop state
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | "inside">("inside");

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [cutPageId, setCutPageId] = useState<number | null>(null);
  const [renamingPage, setRenamingPage] = useState<{ pageId: number; title: string } | null>(null);
  const [bookContextMenu, setBookContextMenu] = useState<BookContextMenuState | null>(null);
  const [renamingBook, setRenamingBook] = useState<{ bookId: number; title: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 2500);
  };

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#folio-context-menu")) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // Close book context menu on outside click or Escape
  useEffect(() => {
    if (!bookContextMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#folio-book-context-menu")) {
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
    setContextMenu(null); // dismiss page context menu if any

    const menuWidth = 220;
    const menuHeight = 220;
    const x = Math.min(e.clientX, Math.max(10, window.innerWidth - menuWidth - 10));
    const y = Math.min(e.clientY, Math.max(10, window.innerHeight - menuHeight - 10));

    setBookContextMenu({ x, y, book });
  };

  // Map parent_page_id to list of child ids
  const childrenMap = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const node of pageTree) {
      if (node.parent_page_id !== null && node.parent_page_id !== undefined) {
        const arr = map.get(node.parent_page_id) || [];
        arr.push(node.page_id);
        map.set(node.parent_page_id, arr);
      }
    }
    return map;
  }, [pageTree]);

  // Map each page_id to its parent_page_id
  const parentMap = useMemo(() => {
    const map = new Map<number, number | null>();
    for (const node of pageTree) {
      map.set(node.page_id, node.parent_page_id ?? null);
    }
    return map;
  }, [pageTree]);

  // A node is visible only if none of its ancestors are in collapsedIds
  const isNodeVisible = (node: PageTreeNode): boolean => {
    let curr = node.parent_page_id;
    while (curr !== null && curr !== undefined) {
      if (collapsedIds.has(curr)) return false;
      curr = parentMap.get(curr) ?? null;
    }
    return true;
  };

  const visibleTree = useMemo(() => {
    return pageTree.filter(isNodeVisible);
  }, [pageTree, collapsedIds, parentMap]);

  // Currently active page node object (if any)
  const activePageNode = useMemo(() => {
    if (!activePageId) return null;
    return pageTree.find((n) => n.page_id === activePageId) || null;
  }, [pageTree, activePageId]);

  // Specific parent node for modal display
  const targetParentNode = useMemo(() => {
    if (!targetParentForNewPage) return null;
    return pageTree.find((n) => n.page_id === targetParentForNewPage) || null;
  }, [pageTree, targetParentForNewPage]);

  // Toggle collapse state for a node
  const toggleCollapse = (pageId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  };

  // Open modal for root or child creation
  const handleOpenCreateModal = (specificParentId?: number | null) => {
    if (specificParentId === null) {
      setTargetParentForNewPage(null);
      setCreateLocation("root");
    } else if (typeof specificParentId === "number") {
      setTargetParentForNewPage(specificParentId);
      setCreateLocation("child");
    } else if (activePageNode) {
      setTargetParentForNewPage(activePageNode.page_id);
      setCreateLocation("child");
    } else {
      setTargetParentForNewPage(null);
      setCreateLocation("root");
    }
    setNewPageTitle("");
    setIsNewPageModalOpen(true);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPageTitle.trim()) return;
    const parentId = createLocation === "child" ? targetParentForNewPage : null;
    onCreatePage(newPageTitle.trim(), parentId);
    setNewPageTitle("");
    setIsNewPageModalOpen(false);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, pageId: number) => {
    e.dataTransfer.setData("text/plain", pageId.toString());
    e.dataTransfer.effectAllowed = "move";
    setDraggedId(pageId);
  };

  const handleDragOverItem = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height;

    let pos: "before" | "inside" | "after";
    if (relY < 0.28) {
      pos = "before";
    } else if (relY > 0.72) {
      pos = "after";
    } else {
      pos = "inside";
    }

    setDropTargetId(targetId);
    setDropPosition(pos);
  };

  const handleDragLeaveItem = (e: React.DragEvent, targetId: number) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dropTargetId === targetId) {
      setDropTargetId(null);
    }
  };

  const handleDropOnItem = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) {
      setDraggedId(null);
      setDropTargetId(null);
      return;
    }

    if (onMovePage) {
      onMovePage(draggedId, targetId, dropPosition);
      if (dropPosition === "inside") {
        setCollapsedIds((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
      }
    }

    setDraggedId(null);
    setDropTargetId(null);
  };

  const handleDropOnRoot = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedId === null) return;
    if (onMovePage) {
      onMovePage(draggedId, null, "inside");
    }
    setDraggedId(null);
    setDropTargetId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDropTargetId(null);
  };

  // Context Menu trigger
  const handleContextMenu = (e: React.MouseEvent, pageId: number, pageTitle: string) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 220;
    const menuHeight = 350;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) {
      x = Math.max(10, window.innerWidth - menuWidth - 10);
    }
    if (y + menuHeight > window.innerHeight) {
      y = Math.max(10, window.innerHeight - menuHeight - 10);
    }

    const isPinned = pinnedPages.some((p) => p.page_id === pageId);
    setContextMenu({ x, y, pageId, pageTitle, isPinned });
  };

  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-72 bg-[#fcf2eb] border-r border-[#e7e5e4] transition-transform duration-200 ease-in-out flex flex-col justify-between select-none shadow-xs ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* 1. App Brand Header with Collapse Button on Top Right */}
          <div className="h-14 px-4 flex items-center justify-between border-b border-[#f0e6e0]">
            <div
              className="flex items-center gap-2.5 cursor-pointer"
              onClick={() => onChangeView("bookshelf")}
            >
              <div className="w-8 h-8 rounded-lg bg-[#f0e6e0] flex items-center justify-center text-[#8d4b00]">
                <span className="material-symbols-outlined text-[20px]">eco</span>
              </div>
              <span className="text-lg font-bold text-[#1f1b17] tracking-tight">
                FolioGraph
              </span>
            </div>

            {/* Sidebar Collapse Button at top right */}
            <button
              onClick={onToggleOpen}
              className="p-1.5 rounded-lg hover:bg-[#f6ece6] text-[#554336] hover:text-[#1f1b17] transition-colors cursor-pointer"
              title="Collapse sidebar"
              type="button"
            >
              <span className="material-symbols-outlined text-[22px]">left_panel_close</span>
            </button>
          </div>

          {/* 2. Book Selection Header Bar (Only visible when a book is selected) */}
          {selectedBook && (
            <div
              onContextMenu={(e) => handleBookContextMenu(e, selectedBook)}
              className="h-12 px-3.5 bg-[#f6ece6] border-b border-[#f0e6e0] flex items-center gap-2 group"
              title={`${selectedBook.title} (Right-click for options)`}
            >
              <button
                onClick={onBackFromBook}
                className="p-1.5 rounded-lg hover:bg-[#eae1da] text-[#554336] hover:text-[#1f1b17] transition-colors cursor-pointer flex items-center justify-center shrink-0"
                title="Back to all books"
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              </button>
              <span className="font-semibold text-sm text-[#1f1b17] truncate flex-1">
                {selectedBook.title}
              </span>
              <button
                type="button"
                onClick={(e) => handleBookContextMenu(e, selectedBook)}
                className="p-1.5 rounded-lg hover:bg-[#eae1da] text-[#554336] hover:text-[#1f1b17] transition-colors cursor-pointer flex items-center justify-center shrink-0"
                title="Book options"
              >
                <span className="material-symbols-outlined text-[18px]">more_vert</span>
              </button>
            </div>
          )}

          {/* 3. Navigation Sections */}
          <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-6">
            {/* STATE A: BOOK SELECTED -> TABLE OF CONTENTS */}
            {selectedBook ? (
              <div>
                <div className="flex items-center justify-between px-1 pb-2 text-xs uppercase tracking-wide text-[#554336] font-bold">
                  <span>Table of Contents</span>
                  <button
                    onClick={() => handleOpenCreateModal(null)}
                    className="p-1 rounded text-[#78716c] hover:text-[#8d4b00] hover:bg-[#f6ece6] transition-colors cursor-pointer flex items-center gap-1"
                    title={`Add root note to ${selectedBook.title}`}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[19px]">add</span>
                  </button>
                </div>

                {pageTree.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-[#78716c] italic bg-white/60 rounded-lg border border-dashed border-[#e7e5e4]">
                    No notes in this book yet. Click + to create one.
                  </div>
                ) : (
                  <nav className="space-y-1">
                    {visibleTree.map((node) => {
                      const isActive = activePageId === node.page_id;
                      const hasChildren = (childrenMap.get(node.page_id)?.length ?? 0) > 0;
                      const isCollapsed = collapsedIds.has(node.page_id);
                      const isBeingDragged = draggedId === node.page_id;
                      const isDropTarget = dropTargetId === node.page_id && !isBeingDragged;
                      const isPinned = pinnedPages.some((p) => p.page_id === node.page_id);
                      const isCut = cutPageId === node.page_id;
                      const indentPx = node.depth * 14;

                      return (
                        <div
                          key={node.page_id}
                          onDragOver={(e) => handleDragOverItem(e, node.page_id)}
                          onDragLeave={(e) => handleDragLeaveItem(e, node.page_id)}
                          onDrop={(e) => handleDropOnItem(e, node.page_id)}
                          style={{ marginLeft: `${indentPx}px` }}
                          className={`group relative rounded-lg transition-all ${
                            isBeingDragged ? "opacity-40" : "opacity-100"
                          } ${
                            isCut ? "opacity-50 ring-1 ring-dashed ring-[#d97706]" : ""
                          } ${
                            isDropTarget && dropPosition === "inside"
                              ? "ring-2 ring-[#d97706] ring-offset-1 bg-[#fff8f2]"
                              : ""
                          }`}
                        >
                          {/* Drop Indicator Bar: Before */}
                          {isDropTarget && dropPosition === "before" && (
                            <div className="absolute -top-1 left-1 right-1 h-0.5 bg-[#d97706] rounded-full z-10 pointer-events-none" />
                          )}

                          <div
                            onClick={() => {
                              onSelectPage(node.page_id);
                              onChangeView("document");
                            }}
                            onContextMenu={(e) => handleContextMenu(e, node.page_id, node.title)}
                            className={`w-full min-h-[36px] flex items-center py-1.5 px-2.5 rounded-lg text-sm transition-colors text-left cursor-pointer ${
                              isActive
                                ? "bg-white text-[#8d4b00] shadow-2xs font-semibold border border-[#e7e5e4]"
                                : "text-[#374151] hover:text-[#111827] hover:bg-[#f6ece6] font-medium"
                            }`}
                            title={`${node.breadcrumb} (Right-click for options)`}
                          >
                            {/* Collapsible Subtree Arrow Button or Icon on Left */}
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={(e) => toggleCollapse(node.page_id, e)}
                                className="w-5 h-5 rounded hover:bg-[#eae1da] flex items-center justify-center text-[#78716c] hover:text-[#1f1b17] transition-colors cursor-pointer shrink-0 mr-1.5"
                                title={isCollapsed ? "Expand subtree" : "Collapse subtree"}
                              >
                                <span className="material-symbols-outlined text-[17px]">
                                  {isCollapsed ? "chevron_right" : "expand_more"}
                                </span>
                              </button>
                            ) : (
                              <div className="w-5 shrink-0 flex items-center justify-center mr-1.5">
                                <span className="material-symbols-outlined text-[16px] text-[#a8a29e]">
                                  {node.depth > 0 ? "subdirectory_arrow_right" : "description"}
                                </span>
                              </div>
                            )}

                            {/* Node Title */}
                            <span className="truncate flex-1">{node.title}</span>

                            {/* Right Actions: 1. Pin, 2. Add sub-note, 3. Reorder handle */}
                            <div
                              className={`flex items-center gap-0.5 shrink-0 ml-1 transition-opacity ${
                                isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                              }`}
                            >
                              {/* 1. Pin Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onTogglePin) onTogglePin(node.page_id);
                                }}
                                className={`p-0.5 rounded cursor-pointer flex items-center justify-center transition-colors ${
                                  isPinned
                                    ? "text-[#d97706] hover:bg-[#eae1da]"
                                    : "text-[#78716c] hover:text-[#d97706] hover:bg-[#eae1da]"
                                }`}
                                title={isPinned ? "Unpin note" : "Pin note to sidebar"}
                              >
                                <span className="material-symbols-outlined text-[16px]">push_pin</span>
                              </button>

                              {/* 2. Add Sub-Note Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenCreateModal(node.page_id);
                                }}
                                className={`p-0.5 text-[#78716c] hover:text-[#8d4b00] hover:bg-[#eae1da] rounded cursor-pointer flex items-center justify-center ${
                                  isPinned ? "opacity-0 group-hover:opacity-100" : ""
                                }`}
                                title={`Add sub-note under "${node.title}"`}
                              >
                                <span className="material-symbols-outlined text-[16px]">add</span>
                              </button>

                              {/* 3. Reorder Drag Handle */}
                              <div
                                draggable={true}
                                onDragStart={(e) => handleDragStart(e, node.page_id)}
                                onDragEnd={handleDragEnd}
                                onClick={(e) => e.stopPropagation()}
                                className={`p-0.5 text-[#a8a29e] hover:text-[#554336] hover:bg-[#eae1da] rounded cursor-grab active:cursor-grabbing flex items-center justify-center ${
                                  isPinned ? "opacity-0 group-hover:opacity-100" : ""
                                }`}
                                title="Drag to reorder or nest"
                              >
                                <span className="material-symbols-outlined text-[16px]">drag_indicator</span>
                              </div>
                            </div>
                          </div>

                          {/* Drop Indicator Bar: After */}
                          {isDropTarget && dropPosition === "after" && (
                            <div className="absolute -bottom-1 left-1 right-1 h-0.5 bg-[#d97706] rounded-full z-10 pointer-events-none" />
                          )}
                        </div>
                      );
                    })}

                    {/* Drop target for moving note to root level */}
                    {draggedId !== null && (
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDropTargetId(null);
                          setDropPosition("inside");
                        }}
                        onDrop={handleDropOnRoot}
                        className={`mt-2 py-2 px-3 border-2 border-dashed rounded-lg text-center text-xs font-semibold transition-colors ${
                          dropTargetId === null
                            ? "border-[#d97706] bg-[#fff8f2] text-[#8d4b00]"
                            : "border-[#e7e5e4] text-[#78716c] hover:border-[#d97706]"
                        }`}
                      >
                        Drop here to move to Root Level
                      </div>
                    )}
                  </nav>
                )}
              </div>
            ) : (
              /* STATE B: DEFAULT SIDEBAR -> WORKSPACE, PINNED PAGES, BOOKS */
              <>
                {/* Section: Workspace */}
                <div>
                  <div className="px-1 pb-2 text-xs uppercase tracking-wide text-[#554336] font-bold">
                    Workspace
                  </div>
                  <nav className="space-y-1">
                    <button
                      type="button"
                      onClick={() => onChangeView("bookshelf")}
                      className={`w-full h-10 flex items-center gap-2.5 px-3 rounded-lg text-sm transition-colors text-left cursor-pointer ${
                        activeView === "bookshelf"
                          ? "bg-white text-[#8d4b00] shadow-2xs font-semibold border border-[#e7e5e4]"
                          : "text-[#374151] hover:text-[#111827] hover:bg-[#f6ece6] font-medium"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[19px]">dashboard</span>
                      <span>Home / Bookshelf</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onChangeView("document");
                      }}
                      className={`w-full h-10 flex items-center gap-2.5 px-3 rounded-lg text-sm transition-colors text-left cursor-pointer ${
                        activeView === "document"
                          ? "bg-white text-[#8d4b00] shadow-2xs font-semibold border border-[#e7e5e4]"
                          : "text-[#374151] hover:text-[#111827] hover:bg-[#f6ece6] font-medium"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[19px]">article</span>
                      <span>Document View</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeView("data")}
                      className={`w-full h-10 flex items-center gap-2.5 px-3 rounded-lg text-sm transition-colors text-left cursor-pointer ${
                        activeView === "data"
                          ? "bg-white text-[#8d4b00] shadow-2xs font-semibold border border-[#e7e5e4]"
                          : "text-[#374151] hover:text-[#111827] hover:bg-[#f6ece6] font-medium"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[19px]">dataset</span>
                      <span>Data Tables</span>
                    </button>
                  </nav>
                </div>

                {/* Section: Pinned Pages */}
                <div>
                  <div className="flex items-center justify-between px-1 pb-2 text-xs uppercase tracking-wide text-[#554336] font-bold">
                    <div className="flex items-center gap-1.5">
                      <span>Pinned Pages</span>
                      {pinnedPages.length > 0 && (
                        <span className="folio-pill-badge bg-[#f6ece6] text-[#78716c] border border-[#e7e5e4]/70">
                          {pinnedPages.length}
                        </span>
                      )}
                    </div>
                    {pinnedPages.length > 0 && (
                      <button
                        type="button"
                        onClick={onCloseAllPinned}
                        className="text-xs text-[#8d4b00] hover:text-[#b45309] font-semibold tracking-normal normal-case hover:underline cursor-pointer flex items-center gap-1"
                        title="Close all pinned pages"
                      >
                        <span className="material-symbols-outlined text-[15px]">clear_all</span>
                        Close all
                      </button>
                    )}
                  </div>
                  {pinnedPages.length === 0 ? (
                    <div className="px-2 py-2 text-sm text-[#78716c] italic">
                      No pinned pages
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {pinnedPages.map((p) => {
                        const isActive = activePageId === p.page_id;
                        return (
                          <div
                            key={p.page_id}
                            onContextMenu={(e) => handleContextMenu(e, p.page_id, p.title)}
                            className={`group w-full h-9 flex items-center justify-between px-2.5 rounded-lg text-sm transition-colors ${
                              isActive
                                ? "bg-white text-[#8d4b00] font-semibold border border-[#e7e5e4] shadow-2xs"
                                : "text-[#374151] hover:bg-[#f6ece6] font-medium"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                onSelectPage(p.page_id);
                                onChangeView("document");
                              }}
                              className="flex items-center gap-2 truncate flex-1 text-left cursor-pointer"
                              title={`${p.title} (Right-click for options)`}
                            >
                              <span className="material-symbols-outlined text-[18px] text-[#d97706] shrink-0">
                                push_pin
                              </span>
                              <span className="truncate">{p.title}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onUnpinPage(p.page_id);
                              }}
                              className="p-1 rounded hover:bg-[#f0e6e0] text-[#78716c] hover:text-[#1f1b17] opacity-0 group-hover:opacity-100 transition-opacity ml-1 cursor-pointer shrink-0"
                              title="Unpin page"
                            >
                              <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Section: Books with + button */}
                <div>
                  <div className="flex items-center justify-between px-1 pb-2 text-xs uppercase tracking-wide text-[#554336] font-bold">
                    <span>Books</span>
                    <button
                      onClick={onCreateBook}
                      className="p-1 rounded text-[#78716c] hover:text-[#8d4b00] hover:bg-[#f6ece6] transition-colors cursor-pointer"
                      title="New Book"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[19px]">add</span>
                    </button>
                  </div>
                  <div className="space-y-1">
                    {sharedBook && (
                      <div className="mb-2">
                        <div
                          className="group w-full h-9 flex items-center justify-between px-2.5 rounded-lg text-sm transition-colors bg-[#fef3c7] hover:bg-[#fde68a] text-[#8d4b00] font-semibold border border-[#f59e0b]/40 cursor-pointer"
                          onClick={() => onSelectBook(sharedBook)}
                          title={`${sharedBook.title} (Shared Editor)`}
                        >
                          <div className="flex items-center gap-2 truncate flex-1 text-left">
                            <span className="material-symbols-outlined text-[18px] text-[#d97706] shrink-0">
                              edit_document
                            </span>
                            <span className="truncate">{sharedBook.title}</span>
                          </div>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#d97706] text-white font-bold shrink-0">
                            SHARED
                          </span>
                        </div>
                      </div>
                    )}
                    {books.map((b) => (
                      <div
                        key={b.book_id}
                        onContextMenu={(e) => handleBookContextMenu(e, b)}
                        className="group w-full h-9 flex items-center justify-between px-2.5 rounded-lg text-sm transition-colors text-[#374151] hover:bg-[#f6ece6] font-medium"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectBook(b)}
                          className="flex items-center gap-2 truncate flex-1 text-left cursor-pointer"
                          title={`${b.title} (Right-click for options)`}
                        >
                          <span className="material-symbols-outlined text-[18px] text-[#8d4b00] shrink-0">
                            menu_book
                          </span>
                          <span className="truncate">{b.title}</span>
                        </button>
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          <button
                            type="button"
                            onClick={(e) => handleBookContextMenu(e, b)}
                            className="p-1 rounded hover:bg-[#eae1da] text-[#78716c] hover:text-[#1f1b17] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            title="Book options"
                          >
                            <span className="material-symbols-outlined text-[16px]">more_vert</span>
                          </button>
                          <span className="folio-pill-badge bg-[#f6ece6] text-[#78716c] border border-[#e7e5e4]/70">
                            {b.total_pages}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Floating Right-Click Context Menu */}
      {contextMenu && (
        <div
          id="folio-context-menu"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 w-56 bg-white/95 backdrop-blur-md border border-[#e7e5e4] shadow-2xl rounded-xl py-1.5 text-xs text-[#1f1b17] animate-scaleUp select-none"
        >
          {/* Header with Title Preview */}
          <div className="px-3 py-1.5 border-b border-[#f0e6e0] text-[#78716c] truncate font-semibold text-[11px]">
            {contextMenu.pageTitle}
          </div>

          <div className="p-1 space-y-0.5">
            {/* 1. Pin / Unpin */}
            <button
              onClick={() => {
                if (onTogglePin) onTogglePin(contextMenu.pageId);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#d97706]">push_pin</span>
              <span>{contextMenu.isPinned ? "Unpin Note" : "Pin to Sidebar"}</span>
            </button>

            {/* 2. New Sub-Note */}
            <button
              onClick={() => {
                handleOpenCreateModal(contextMenu.pageId);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#78716c]">add</span>
              <span>New Sub-note</span>
            </button>

            {/* 3. Rename */}
            <button
              onClick={() => {
                setRenamingPage({ pageId: contextMenu.pageId, title: contextMenu.pageTitle });
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#78716c]">edit</span>
              <span>Rename</span>
            </button>

            {/* Divider */}
            <div className="h-px bg-[#f0e6e0] my-1" />

            {/* 4. Cut Note */}
            <button
              onClick={() => {
                setCutPageId(contextMenu.pageId);
                showToast(`Cut "${contextMenu.pageTitle}"`);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#78716c]">content_cut</span>
              <span>Cut Note</span>
            </button>

            {/* 5. Copy Markdown Link */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(`[[${contextMenu.pageTitle}]]`);
                showToast(`Copied [[${contextMenu.pageTitle}]] to clipboard`);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#78716c]">link</span>
              <span>Copy Markdown Link</span>
            </button>

            {/* 6. Paste as Sub-note (enabled if something was cut) */}
            {cutPageId && cutPageId !== contextMenu.pageId && (
              <button
                onClick={() => {
                  if (onMovePage) {
                    onMovePage(cutPageId, contextMenu.pageId, "inside");
                    showToast(`Pasted inside "${contextMenu.pageTitle}"`);
                  }
                  setCutPageId(null);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left bg-[#fff8f2] hover:bg-[#faebd7] text-[#8d4b00] font-semibold transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[17px] text-[#8d4b00]">content_paste</span>
                <span>Paste as Sub-note</span>
              </button>
            )}

            {/* Divider */}
            <div className="h-px bg-[#f0e6e0] my-1" />

            {/* 7. Properties & Access */}
            <button
              onClick={() => {
                if (onOpenInspectorTab) {
                  onOpenInspectorTab(contextMenu.pageId, "grants");
                } else {
                  onSelectPage(contextMenu.pageId);
                  onChangeView("document");
                }
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#78716c]">tune</span>
              <span>Properties & Access</span>
            </button>

            {/* 8. Revision History */}
            <button
              onClick={() => {
                if (onOpenInspectorTab) {
                  onOpenInspectorTab(contextMenu.pageId, "history");
                } else {
                  onSelectPage(contextMenu.pageId);
                  onChangeView("document");
                }
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#78716c]">history</span>
              <span>Revision History</span>
            </button>

            {/* Divider */}
            <div className="h-px bg-[#f0e6e0] my-1" />

            {/* 9. Delete Note */}
            <button
              onClick={() => {
                if (onDeletePage) onDeletePage(contextMenu.pageId);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-red-50 text-red-600 transition-colors cursor-pointer font-semibold"
            >
              <span className="material-symbols-outlined text-[17px] text-red-600">delete</span>
              <span>Delete Note</span>
            </button>
          </div>
        </div>
      )}

      {/* Rename Dialog Modal */}
      {renamingPage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-[#e7e5e4] shadow-xl max-w-sm w-full p-5 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#1f1b17]">Rename Note</h3>
              <button
                onClick={() => setRenamingPage(null)}
                className="text-[#78716c] hover:text-[#1f1b17] p-1 rounded hover:bg-[#f6ece6] cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (renamingPage.title.trim() && onRenamePage) {
                  onRenamePage(renamingPage.pageId, renamingPage.title.trim());
                  showToast(`Renamed to "${renamingPage.title.trim()}"`);
                }
                setRenamingPage(null);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-[#554336] mb-1.5">
                  Note Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={renamingPage.title}
                  onChange={(e) =>
                    setRenamingPage({ ...renamingPage, title: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#fcf2eb] border border-[#e7e5e4] text-sm text-[#1f1b17] focus:outline-none focus:border-[#d97706]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRenamingPage(null)}
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

      {/* Floating Right-Click Book Context Menu */}
      {bookContextMenu && (
        <div
          id="folio-book-context-menu"
          style={{ top: `${bookContextMenu.y}px`, left: `${bookContextMenu.x}px` }}
          className="fixed z-50 w-56 bg-white/95 backdrop-blur-md border border-[#e7e5e4] shadow-2xl rounded-xl py-1.5 text-xs text-[#1f1b17] animate-scaleUp select-none"
        >
          {/* Header with Book Title */}
          <div className="px-3 py-1.5 border-b border-[#f0e6e0] text-[#78716c] truncate font-semibold text-[11px] flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-[#8d4b00]">menu_book</span>
            <span className="truncate">{bookContextMenu.book.title}</span>
          </div>

          <div className="p-1 space-y-0.5">
            {/* 1. Open Book / View Notes */}
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
                handleOpenCreateModal(null);
                setBookContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#2563eb]">add_circle</span>
              <span>New Note in Book</span>
            </button>

            {/* 3. Manage Data Grants */}
            <button
              onClick={() => {
                if (onManageBookGrants) onManageBookGrants(bookContextMenu.book);
                setBookContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#006a61]">verified_user</span>
              <span>Manage Data Grants</span>
            </button>

            {/* 4. Rename Book */}
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

            {/* 5. Copy Book Reference */}
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

            {/* 6. Export Book */}
            <button
              onClick={async () => {
                const b = bookContextMenu.book;
                setBookContextMenu(null);
                try {
                  showToast(`Preparing export for "${b.title}"...`);
                  await downloadBookExport(b.book_id);
                  showToast(`Exported "${b.title}" successfully!`);
                } catch (err: any) {
                  showToast(`Export failed: ${err.message}`);
                }
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#78716c]">file_download</span>
              <span>Export Notebook (ZIP)</span>
            </button>

            {/* 7. Publish to Web */}
            <button
              onClick={() => {
                const b = bookContextMenu.book;
                setBookContextMenu(null);
                if (onPublishBook) onPublishBook(b);
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#f6ece6] transition-colors cursor-pointer text-[#1f1b17]"
            >
              <span className="material-symbols-outlined text-[17px] text-[#78716c]">public</span>
              <span>Publish to Web</span>
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

      {/* New Page Modal Dialog */}
      {isNewPageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl border border-[#e7e5e4] shadow-lg max-w-sm w-full p-5 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#1f1b17]">
                New Note in {selectedBook?.title}
              </h3>
              <button
                onClick={() => setIsNewPageModalOpen(false)}
                className="text-[#78716c] hover:text-[#1f1b17] p-1 rounded hover:bg-[#f6ece6] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#554336] mb-1.5">
                  Note Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newPageTitle}
                  onChange={(e) => setNewPageTitle(e.target.value)}
                  placeholder="e.g. Project Overview"
                  className="w-full px-3 py-2 rounded-lg bg-[#fcf2eb] border border-[#e7e5e4] text-sm text-[#1f1b17] focus:outline-none focus:border-[#d97706]"
                />
              </div>

              {/* Location Selector: Sub-note vs Root note */}
              <div>
                <label className="block text-xs font-semibold text-[#554336] mb-1.5">
                  Location in Book
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setCreateLocation("child")}
                    disabled={!targetParentNode}
                    className={`p-2.5 rounded-lg border text-left transition-colors ${
                      createLocation === "child" && targetParentNode
                        ? "border-[#d97706] bg-[#fff8f2] text-[#8d4b00] font-semibold ring-1 ring-[#d97706]"
                        : "border-[#e7e5e4] bg-[#fcf2eb] text-[#554336] hover:bg-[#f6ece6]"
                    } ${!targetParentNode ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="material-symbols-outlined text-[16px]">subdirectory_arrow_right</span>
                      <span className="font-semibold">Sub-note</span>
                    </div>
                    <span className="text-[11px] text-[#78716c] truncate block" title={targetParentNode?.title}>
                      {targetParentNode ? `inside "${targetParentNode.title}"` : "No parent selected"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCreateLocation("root")}
                    className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      createLocation === "root" || !targetParentNode
                        ? "border-[#d97706] bg-[#fff8f2] text-[#8d4b00] font-semibold ring-1 ring-[#d97706]"
                        : "border-[#e7e5e4] bg-[#fcf2eb] text-[#554336] hover:bg-[#f6ece6]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="material-symbols-outlined text-[16px]">topic</span>
                      <span className="font-semibold">Root Note</span>
                    </div>
                    <span className="text-[11px] text-[#78716c] truncate block">
                      top level in book
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewPageModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-xs text-[#78716c] hover:bg-[#f6ece6] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#d97706] hover:bg-[#b45309] text-white shadow-xs cursor-pointer"
                >
                  Create Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
