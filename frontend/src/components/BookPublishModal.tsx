import React, { useState, useEffect } from "react";
import { api, type Book, type BookPublishInfo } from "../api";

interface BookPublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book | null;
  onUpdated?: (info: BookPublishInfo) => void;
}

export const BookPublishModal: React.FC<BookPublishModalProps> = ({
  isOpen,
  onClose,
  book,
  onUpdated,
}) => {
  const [publishInfo, setPublishInfo] = useState<BookPublishInfo | null>(null);
  const [isPublished, setIsPublished] = useState(false);
  const [accessMode, setAccessMode] = useState<"VIEWER" | "EDITOR">("VIEWER");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !book) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const info = await api.getBookPublish(book.book_id);
        setPublishInfo(info);
        setIsPublished(info.is_published);
        setAccessMode(info.access_mode || "VIEWER");
      } catch (err: any) {
        setError(err.message || "Failed to load publishing configuration.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isOpen, book]);

  if (!isOpen || !book) return null;

  const publicUrl = publishInfo?.share_token
    ? `${window.location.origin}/share/${publishInfo.share_token}`
    : null;

  const handleCopyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = publicUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSave = async (newPublishedState?: boolean, newMode?: "VIEWER" | "EDITOR") => {
    const targetPublished = newPublishedState !== undefined ? newPublishedState : isPublished;
    const targetMode = newMode !== undefined ? newMode : accessMode;

    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateBookPublish(book.book_id, {
        is_published: targetPublished,
        access_mode: targetMode,
      });
      setPublishInfo(updated);
      setIsPublished(updated.is_published);
      setAccessMode(updated.access_mode);
      if (onUpdated) onUpdated(updated);
    } catch (err: any) {
      setError(err.message || "Failed to update publish settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublish = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.checked;
    setIsPublished(nextVal);
    await handleSave(nextVal, accessMode);
  };

  const handleModeChange = async (mode: "VIEWER" | "EDITOR") => {
    setAccessMode(mode);
    if (isPublished) {
      await handleSave(isPublished, mode);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl border border-[#e7e5e4] shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#f0e6e0] flex items-center justify-between bg-[#fcf2eb]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#f0e6e0] flex items-center justify-center text-[#8d4b00]">
              <span className="material-symbols-outlined text-[20px]">public</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-[#1f1b17]">Publish to Web</h3>
              <p className="text-xs text-[#554336]">Share "{book.title}" via a public link</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#78716c] hover:text-[#1f1b17] p-1.5 rounded-lg hover:bg-[#eae1da] transition-colors cursor-pointer"
            type="button"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] text-red-500 shrink-0">error</span>
              <div className="flex-1">{error}</div>
            </div>
          )}

          {loading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-[#78716c]">
              <span className="material-symbols-outlined animate-spin text-[24px] text-[#8d4b00]">progress_activity</span>
              <span className="text-xs font-medium">Loading publication status...</span>
            </div>
          ) : (
            <>
              {/* Publish Toggle Card */}
              <div className="p-4 rounded-xl border border-[#e7e5e4] bg-[#fcf2eb] flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-sm font-bold text-[#1f1b17] block">Publish to Web</span>
                  <span className="text-xs text-[#554336] block">
                    {isPublished
                      ? "This notebook is live and accessible via its public link."
                      : "Make this notebook available publicly on the web."}
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={isPublished}
                    disabled={saving}
                    onChange={handleTogglePublish}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#e7e5e4] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#d6d3d1] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#d97706]"></div>
                </label>
              </div>

              {isPublished && (
                <div className="space-y-4 animate-fadeIn">
                  {/* Access Mode Selector */}
                  <div>
                    <label className="block text-xs font-semibold text-[#554336] mb-2">
                      Access Mode
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleModeChange("VIEWER")}
                        disabled={saving}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                          accessMode === "VIEWER"
                            ? "border-[#d97706] bg-[#fff8f2] ring-1 ring-[#d97706]"
                            : "border-[#e7e5e4] bg-white hover:bg-[#faf5f0]"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs text-[#1f1b17]">
                          <span className="material-symbols-outlined text-[16px] text-[#8d4b00]">visibility</span>
                          <span>Viewer (Read-only)</span>
                        </div>
                        <p className="text-[11px] text-[#78716c] leading-relaxed">
                          Anyone with the link can view notes and execute embedded SQL queries.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleModeChange("EDITOR")}
                        disabled={saving}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                          accessMode === "EDITOR"
                            ? "border-[#d97706] bg-[#fff8f2] ring-1 ring-[#d97706]"
                            : "border-[#e7e5e4] bg-white hover:bg-[#faf5f0]"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs text-[#1f1b17]">
                          <span className="material-symbols-outlined text-[16px] text-[#8d4b00]">edit_note</span>
                          <span>Editor (Editable)</span>
                        </div>
                        <p className="text-[11px] text-[#78716c] leading-relaxed">
                          Includes an "Edit Book" button that lets logged-in users edit notes via the link.
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Public Link Box */}
                  {publicUrl && (
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-[#554336]">
                        Public Web Link
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#fcf2eb] border border-[#e7e5e4] text-xs text-[#1f1b17] font-mono select-all truncate">
                          <span className="material-symbols-outlined text-[16px] text-[#8d4b00] shrink-0">link</span>
                          <span className="truncate">{publicUrl}</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyLink}
                          className="px-3.5 py-2 rounded-lg bg-[#8d4b00] hover:bg-[#703b00] text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {copied ? "check" : "content_copy"}
                          </span>
                          <span>{copied ? "Copied" : "Copy"}</span>
                        </button>
                        <a
                          href={publicUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-lg bg-[#f0e6e0] hover:bg-[#eae1da] text-[#1f1b17] transition-colors flex items-center justify-center shrink-0"
                          title="Open published link in new tab"
                        >
                          <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Informational Guidance Badge */}
                  <div className="p-3 rounded-xl bg-[#fff8f2] border border-[#fde68a] text-xs text-[#554336] flex items-start gap-2">
                    <span className="material-symbols-outlined text-[18px] text-[#d97706] shrink-0">info</span>
                    <div className="leading-relaxed text-[11px]">
                      {accessMode === "EDITOR" ? (
                        <>
                          Visitors can view notes without signing in. Logged-in users clicking <strong>"Edit Book"</strong> can edit pages and add new notes. Edits record their author history without cluttering their personal library.
                        </>
                      ) : (
                        <>
                          Visitors can view notes and run embedded SQL queries safely using the table permissions you have granted to this notebook.
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[#faf5f0] border-t border-[#f0e6e0] flex items-center justify-between">
          <div className="text-[11px] text-[#78716c]">
            {saving ? "Saving changes..." : isPublished ? "Link active" : "Unpublished"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#8d4b00] hover:bg-[#703b00] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
