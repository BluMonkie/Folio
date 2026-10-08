import React, { useState, useEffect } from "react";
import type { PageGrantItem, BacklinkItem, EditHistoryItem, TagItem, QueryableTableItem } from "../api";
import { api } from "../api";

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
  activePageId?: number | null;
  onGrantsUpdated?: () => void;
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
  activePageId,
  onGrantsUpdated,
}) => {
  const [localTab, setLocalTab] = useState<"grants" | "backlinks" | "history" | "tags">("grants");
  const activeTab = tab ?? localTab;
  const setActiveTab = onTabChange ?? setLocalTab;

  // Page Grant Controls state
  const [isAddingGrant, setIsAddingGrant] = useState(false);
  const [queryableTables, setQueryableTables] = useState<QueryableTableItem[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [canRead, setCanRead] = useState(true);
  const [grantLoading, setGrantLoading] = useState(false);

  useEffect(() => {
    if (isOpen && activeTab === "grants") {
      api.listQueryableTables().then((tables) => {
        setQueryableTables(tables);
        if (tables.length > 0 && selectedTableId === null) {
          setSelectedTableId(tables[0].table_id);
        }
      }).catch(console.error);
    }
  }, [isOpen, activeTab]);

  const handleAddPageGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePageId || !selectedTableId) return;
    setGrantLoading(true);
    try {
      await api.grantTableToPage(activePageId, selectedTableId, canRead);
      setIsAddingGrant(false);
      if (onGrantsUpdated) onGrantsUpdated();
    } catch (err: any) {
      alert(`Grant failed: ${err.message || err}`);
    } finally {
      setGrantLoading(false);
    }
  };

  const handleRevokePageGrant = async (grantId: number, tableName: string) => {
    if (!activePageId) return;
    if (!window.confirm(`Revoke page-level override for '${tableName}'?`)) return;
    try {
      await api.revokePageGrant(activePageId, grantId);
      if (onGrantsUpdated) onGrantsUpdated();
    } catch (err: any) {
      alert(`Revoke failed: ${err.message || err}`);
    }
  };

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
            {/* Add Grant Toggle / Form */}
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs font-bold text-[#554336] uppercase tracking-wider">
                Table Permissions
              </span>
              {activePageId && (
                <button
                  type="button"
                  onClick={() => setIsAddingGrant(!isAddingGrant)}
                  className="text-xs text-[#8d4b00] font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {isAddingGrant ? "close" : "add"}
                  </span>
                  <span>{isAddingGrant ? "Cancel" : "Add Grant"}</span>
                </button>
              )}
            </div>

            {isAddingGrant && activePageId && (
              <form onSubmit={handleAddPageGrant} className="p-3 bg-white border border-[#d97706]/40 rounded-xl shadow-xs space-y-2.5 animate-fadeIn text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-[#554336] mb-1">
                    Select Queryable Table
                  </label>
                  <select
                    value={selectedTableId ?? ""}
                    onChange={(e) => setSelectedTableId(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#e7e5e4] font-mono text-xs focus:outline-none focus:border-[#d97706]"
                  >
                    {queryableTables.map((t) => (
                      <option key={t.table_id} value={t.table_id}>
                        {t.table_name} ({t.db})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-1.5 text-[11px] text-[#554336] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canRead}
                      onChange={(e) => setCanRead(e.target.checked)}
                    />
                    <span>Allow SELECT</span>
                  </label>

                  <button
                    type="submit"
                    disabled={grantLoading || queryableTables.length === 0}
                    className="px-3 py-1 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] text-white font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {grantLoading ? "Granting..." : "Grant"}
                  </button>
                </div>
              </form>
            )}

            {grants.length === 0 ? (
              <div className="text-center py-6 text-[#78716c] italic text-xs">
                No table permissions configured for this note.
              </div>
            ) : (
              grants.map((g, idx) => (
                <div key={idx} className="bg-white border border-[#e7e5e4] rounded-xl p-3 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-[#1f1b17] font-mono">{g.table_name}</span>
                    </div>
                    <span
                      className={`folio-pill-badge text-[10px] uppercase tracking-wider ${
                        g.source_tier === "PAGE"
                          ? "bg-[#d97706]/15 text-[#8d4b00] border border-[#d97706]/30"
                          : "bg-[#006a61]/15 text-[#006a61] border border-[#006a61]/30"
                      }`}
                    >
                      {g.source_tier === "PAGE" ? "Note Override" : "Inherited from Book"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[11px] border-t border-[#f0e6e0]">
                    <div className={g.can_read ? "text-[#006a61] font-medium" : "text-[#78716c] opacity-50"}>
                      Read: {g.can_read ? "Allowed ✓" : "Blocked ✗"}
                    </div>

                    {g.source_tier === "PAGE" && g.page_grant_id && (
                      <button
                        type="button"
                        onClick={() => handleRevokePageGrant(g.page_grant_id!, g.table_name)}
                        className="text-red-600 hover:text-red-700 hover:underline flex items-center gap-0.5 cursor-pointer text-[10px]"
                        title="Revoke page override"
                      >
                        <span className="material-symbols-outlined text-[13px]">delete</span>
                        <span>Revoke</span>
                      </button>
                    )}
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
