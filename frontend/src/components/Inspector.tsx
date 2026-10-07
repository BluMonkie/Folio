import React, { useState } from "react";
import type { PageGrantItem, BacklinkItem, EditHistoryItem, TagItem } from "../api";

interface InspectorProps {
  isOpen: boolean;
  onClose: () => void;
  grants: PageGrantItem[];
  backlinks: BacklinkItem[];
  history: EditHistoryItem[];
  tags: TagItem[];
  onNavigatePage: (pageId: number) => void;
  tab?: "grants" | "backlinks" | "history" | "tags";
  onTabChange?: (tab: "grants" | "backlinks" | "history" | "tags") => void;
}

export const Inspector: React.FC<InspectorProps> = ({
  isOpen,
  onClose,
  grants,
  backlinks,
  history,
  tags,
  onNavigatePage,
  tab,
  onTabChange,
}) => {
  const [localTab, setLocalTab] = useState<"grants" | "backlinks" | "history" | "tags">("grants");
  const activeTab = tab ?? localTab;
  const setActiveTab = onTabChange ?? setLocalTab;

  if (!isOpen) return null;

  return (
    <aside className="w-80 bg-[#fcf2eb] border-l border-[#e7e5e4] flex flex-col h-screen select-none text-sm shrink-0">
      {/* Header */}
      <div className="p-3.5 border-b border-[#e7e5e4] flex items-center justify-between bg-[#f6ece6]">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-[#8d4b00]">dock_to_left</span>
          <span className="text-sm font-semibold text-[#1f1b17]">Document Details</span>
        </div>
        <button
          onClick={onClose}
          className="text-[#78716c] hover:text-[#1f1b17] p-1 rounded-lg hover:bg-[#eae1da] transition-colors cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#e7e5e4] bg-[#fcf2eb]">
        <button
          onClick={() => setActiveTab("grants")}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1 border-b-2 text-sm transition-colors cursor-pointer ${
            activeTab === "grants"
              ? "border-[#d97706] text-[#8d4b00] font-semibold bg-white"
              : "border-transparent text-[#78716c] hover:text-[#1f1b17] font-medium"
          }`}
        >
          <span>Access</span>
        </button>
        <button
          onClick={() => setActiveTab("backlinks")}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 border-b-2 text-sm transition-colors cursor-pointer ${
            activeTab === "backlinks"
              ? "border-[#d97706] text-[#8d4b00] font-semibold bg-white"
              : "border-transparent text-[#78716c] hover:text-[#1f1b17] font-medium"
          }`}
        >
          <span>Backlinks</span>
          {backlinks.length > 0 && (
            <span className="folio-pill-badge bg-[#f0e6e0] text-[#554336] !h-4.5 !min-w-[18px] !px-1.5 text-xs font-semibold">
              {backlinks.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1 border-b-2 text-sm transition-colors cursor-pointer ${
            activeTab === "history"
              ? "border-[#d97706] text-[#8d4b00] font-semibold bg-white"
              : "border-transparent text-[#78716c] hover:text-[#1f1b17] font-medium"
          }`}
        >
          <span>History</span>
        </button>
        <button
          onClick={() => setActiveTab("tags")}
          className={`flex-1 py-2.5 flex items-center justify-center gap-1 border-b-2 text-sm transition-colors cursor-pointer ${
            activeTab === "tags"
              ? "border-[#d97706] text-[#8d4b00] font-semibold bg-white"
              : "border-transparent text-[#78716c] hover:text-[#1f1b17] font-medium"
          }`}
        >
          <span>Tags</span>
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* TAB 1: ACCESS */}
        {activeTab === "grants" && (
          <div className="space-y-3">
            {grants.length === 0 ? (
              <div className="text-center py-6 text-[#78716c] italic">No special data permissions configured.</div>
            ) : (
              grants.map((g, idx) => (
                <div key={idx} className="bg-white border border-[#e7e5e4] rounded-xl p-3 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-[#1f1b17]">{g.table_name}</span>
                    </div>
                    <span
                      className={`folio-pill-badge text-[10px] uppercase tracking-wider ${
                        g.source_tier === "PAGE"
                          ? "bg-[#d97706]/15 text-[#8d4b00] border border-[#d97706]/30"
                          : "bg-[#006a61]/15 text-[#006a61] border border-[#006a61]/30"
                      }`}
                    >
                      {g.source_tier === "PAGE" ? "Custom Note Access" : "Inherited from Book"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1 pt-1 text-[11px] text-center border-t border-[#f0e6e0]">
                    <div className={g.can_read ? "text-[#006a61] font-medium" : "text-[#78716c] opacity-50"}>
                      Read: {g.can_read ? "✓" : "✗"}
                    </div>
                    <div className={g.can_write ? "text-[#006a61] font-medium" : "text-[#78716c] opacity-50"}>
                      Write: {g.can_write ? "✓" : "✗"}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 2: BACKLINKS */}
        {activeTab === "backlinks" && (
          <div className="space-y-3">
            {backlinks.length === 0 ? (
              <div className="text-center py-6 text-[#78716c] italic">No incoming links to this note yet.</div>
            ) : (
              <div className="space-y-1.5">
                {backlinks.map((b) => (
                  <button
                    key={b.page_id}
                    onClick={() => onNavigatePage(b.page_id)}
                    className="w-full text-left p-2.5 rounded-xl bg-white border border-[#e7e5e4] hover:border-[#dbc2b0] transition shadow-2xs group flex items-center justify-between cursor-pointer"
                  >
                    <div className="truncate">
                      <div className="font-medium text-[#1f1b17] group-hover:text-[#8d4b00] transition truncate">
                        {b.title}
                      </div>
                      <div className="text-[10px] text-[#78716c] font-mono">/{b.slug}</div>
                    </div>
                    <span className="material-symbols-outlined text-[14px] text-[#78716c] group-hover:text-[#8d4b00]">
                      arrow_forward
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: AUDIT HISTORY */}
        {activeTab === "history" && (
          <div className="space-y-3">
            {history.length === 0 ? (
              <div className="text-center py-6 text-[#78716c] italic">No revisions recorded yet.</div>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.edit_id} className="p-2.5 rounded-xl bg-white border border-[#e7e5e4] shadow-2xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#1f1b17]">{h.user_name || "Author"}</span>
                      <span className="text-[10px] text-[#78716c] font-mono">{h.action}</span>
                    </div>
                    <div className="text-[10px] text-[#78716c]">
                      {h.edit_time ? new Date(h.edit_time).toLocaleString() : "Recent"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: TAGS */}
        {activeTab === "tags" && (
          <div className="space-y-3">
            {tags.length === 0 ? (
              <div className="text-center py-6 text-[#78716c] italic">No tags associated with this page.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t.tag_id}
                    className="folio-pill-badge bg-white text-[#006a61] border border-[#e7e5e4] !h-6 !px-2.5 text-xs font-medium"
                  >
                    #{t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
