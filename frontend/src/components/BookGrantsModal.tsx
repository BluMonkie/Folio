import React, { useState, useEffect, useCallback } from "react";
import {
  api,
  type Book,
  type BookGrantItem,
  type QueryableTableItem
} from "../api";

interface BookGrantsModalProps {
  book: Book;
  onClose: () => void;
  onUpdated?: () => void;
}

export function BookGrantsModal({ book, onClose, onUpdated }: BookGrantsModalProps) {
  const [grants, setGrants] = useState<BookGrantItem[]>([]);
  const [queryableTables, setQueryableTables] = useState<QueryableTableItem[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [canRead, setCanRead] = useState(true);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [gList, tList] = await Promise.all([
        api.listBookGrants(book.book_id),
        api.listQueryableTables(),
      ]);
      setGrants(gList);
      setQueryableTables(tList);
      if (tList.length > 0 && selectedTableId === null) {
        setSelectedTableId(tList[0].table_id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load book grants.");
    } finally {
      setLoading(false);
    }
  }, [book.book_id, selectedTableId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGrantTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTableId) return;
    setActionLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.grantTableToBook(book.book_id, selectedTableId, canRead);
      setSuccessMsg("Table permission granted to book.");
      await loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to grant table access.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeGrant = async (grantId: number, tableName: string) => {
    if (!window.confirm(`Revoke default access to '${tableName}' for all pages in ${book.title}?`)) {
      return;
    }
    setActionLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.revokeBookGrant(book.book_id, grantId);
      setSuccessMsg(`Access to '${tableName}' revoked.`);
      await loadData();
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to revoke grant.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl border border-[#e7e5e4] shadow-2xl max-w-lg w-full p-6 space-y-5 animate-scaleUp text-[#1f1b17] font-sans">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#f0e6e0]">
          <div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-[#8d4b00]">
                verified_user
              </span>
              <h3 className="text-base font-bold text-[#1f1b17]">
                Book Data Grants
              </h3>
            </div>
            <p className="text-xs text-[#78716c] mt-0.5">
              Configure which MySQL tables pages in <span className="font-semibold text-[#1f1b17]">{book.title}</span> can query by default.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#78716c] hover:bg-[#f6ece6] cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Feedback alerts */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form: Add Book Grant */}
        <form onSubmit={handleGrantTable} className="p-3.5 bg-[#fcf8f5] rounded-xl border border-[#e7e5e4] space-y-3 text-xs">
          <div className="font-semibold text-[#554336] flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-[#8d4b00]">add_circle</span>
            <span>Grant Table Access to Book</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
            <div className="sm:col-span-2">
              <select
                value={selectedTableId ?? ""}
                onChange={(e) => setSelectedTableId(Number(e.target.value))}
                className="w-full px-3 py-1.5 rounded-lg border border-[#e7e5e4] bg-white font-mono text-xs focus:outline-none focus:border-[#d97706]"
              >
                {queryableTables.map((t) => (
                  <option key={t.table_id} value={t.table_id}>
                    {t.table_name} ({t.db})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-[#554336] font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={canRead}
                  onChange={(e) => setCanRead(e.target.checked)}
                />
                <span>Allow Read</span>
              </label>

              <button
                type="submit"
                disabled={actionLoading || queryableTables.length === 0}
                className="flex-1 h-8 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] text-white font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? "Saving..." : "Grant"}
              </button>
            </div>
          </div>
        </form>

        {/* Existing Grants List */}
        <div>
          <div className="flex items-center justify-between pb-2 text-xs font-semibold text-[#554336]">
            <span>Active Default Grants ({grants.length})</span>
            <span className="text-[11px] text-[#78716c] font-normal">Inherited by all notes</span>
          </div>

          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {loading ? (
              <div className="p-4 text-center text-xs text-[#78716c] italic">
                Loading grants...
              </div>
            ) : grants.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#78716c] italic bg-[#fcf8f5] rounded-xl border border-dashed border-[#e7e5e4]">
                No table access granted to this book yet.
              </div>
            ) : (
              grants.map((g) => (
                <div
                  key={g.grant_id}
                  className="flex items-center justify-between p-3 rounded-xl bg-white border border-[#e7e5e4] shadow-2xs text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-[#006a61]">
                      table_chart
                    </span>
                    <div>
                      <span className="font-bold text-[#1f1b17] font-mono">{g.table_name}</span>
                      <span className="text-[11px] text-[#78716c] ml-2">({g.db})</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="folio-pill-badge bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px]">
                      SELECT Allowed
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRevokeGrant(g.grant_id, g.table_name)}
                      className="p-1 rounded text-red-600 hover:bg-red-50 cursor-pointer"
                      title="Revoke access"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-[#f0e6e0]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#f6ece6] hover:bg-[#eae1da] text-[#554336] font-semibold text-xs transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
