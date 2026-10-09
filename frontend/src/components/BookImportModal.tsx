import React, { useState, useRef } from "react";
import { api, type BookImportResponse } from "../api";

interface BookImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: BookImportResponse) => void;
}

export const BookImportModal: React.FC<BookImportModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [restoreGrants, setRestoreGrants] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const cleanTitleFromFilename = (filename: string): string => {
    const base = filename.replace(/\.zip$/i, "");
    return base
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  };

  const handleFileSelection = (selected: File) => {
    setError(null);
    if (!selected.name.toLowerCase().endsWith(".zip")) {
      setError("Please select a valid .zip notebook export.");
      return;
    }
    setFile(selected);
    setCustomTitle(cleanTitleFromFilename(selected.name));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    handleFileSelection(selected);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelection(droppedFile);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a .zip archive to import.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (customTitle.trim()) {
        formData.append("title", customTitle.trim());
      }
      formData.append("restore_grants", String(restoreGrants));

      const result = await api.importBook(formData);
      onSuccess(result);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to import notebook archive.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetSelection = () => {
    setFile(null);
    setCustomTitle("");
    setRestoreGrants(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl border border-[#e7e5e4] shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#f0e6e0] flex items-center justify-between bg-[#fcf2eb]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#f0e6e0] flex items-center justify-center text-[#8d4b00]">
              <span className="material-symbols-outlined text-[20px]">folder_zip</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-[#1f1b17]">Import Notebook</h3>
              <p className="text-xs text-[#554336]">Upload a .zip package to import your notebook</p>
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2 animate-fadeIn">
              <span className="material-symbols-outlined text-[18px] text-red-500 shrink-0">error</span>
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          )}

          {/* File Picker Zone */}
          {!file ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#d97706]/40 hover:border-[#d97706] rounded-xl p-8 text-center bg-[#fff8f2] hover:bg-[#ffedd5]/30 transition-colors cursor-pointer space-y-3"
            >
              <div className="w-12 h-12 rounded-full bg-[#f0e6e0] text-[#8d4b00] flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-[26px]">folder_zip</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1f1b17]">Choose a Folio ZIP archive</p>
                <p className="text-xs text-[#78716c] mt-0.5">Select a .zip notebook export</p>
              </div>
              <span className="inline-block px-3 py-1 bg-white text-[#8d4b00] border border-[#e7e5e4] rounded-md text-xs font-semibold shadow-2xs">
                Browse Files
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-4">
              {/* File Info Card */}
              <div className="p-3.5 rounded-xl bg-[#fcf2eb] border border-[#e7e5e4] flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <span className="material-symbols-outlined text-[26px] text-[#8d4b00] shrink-0">
                    archive
                  </span>
                  <div className="truncate">
                    <div className="text-xs font-semibold text-[#1f1b17] truncate">{file.name}</div>
                    <div className="text-[11px] text-[#78716c]">
                      {formatFileSize(file.size)} • ZIP Archive
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={resetSelection}
                  className="text-xs text-[#78716c] hover:text-red-600 px-2.5 py-1 rounded hover:bg-[#eae1da] transition-colors cursor-pointer font-medium shrink-0"
                >
                  Change
                </button>
              </div>

              {/* Title Input */}
              <div>
                <label className="block text-xs font-semibold text-[#554336] mb-1.5">
                  Notebook Title (Optional)
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Defaults to original book title in archive"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#fcf2eb] border border-[#e7e5e4] text-sm text-[#1f1b17] focus:outline-none focus:border-[#d97706]"
                />
                <p className="text-[11px] text-[#78716c] mt-1">
                  Leave blank to retain the notebook's original title.
                </p>
              </div>

              {/* Explicit Grant Restoration Prompt */}
              <div className="p-3.5 rounded-xl border border-[#f0e6e0] bg-[#fcf2eb] space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreGrants}
                    onChange={(e) => setRestoreGrants(e.target.checked)}
                    className="mt-0.5 rounded text-[#d97706] focus:ring-[#d97706]"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-[#1f1b17]">
                      Restore SQL Table Access
                    </div>
                    <p className="text-[12px] text-[#554336] mt-0.5 leading-relaxed">
                      Checking will allow this notebook to access the SQL tables configured in it.{" "}
                      <span className="text-red-600 font-semibold">Check this with caution.</span>
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#f0e6e0]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg text-xs font-medium text-[#78716c] hover:bg-[#f6ece6] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!file || isSubmitting}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors ${
                !file || isSubmitting
                  ? "bg-[#e7e5e4] text-[#a8a29e] cursor-not-allowed"
                  : "bg-[#d97706] hover:bg-[#b45309] text-white cursor-pointer"
              }`}
            >
              {isSubmitting ? (
                <>
                  <span className="material-symbols-outlined text-[16px] animate-spin">refresh</span>
                  <span>Importing Archive...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">file_download_done</span>
                  <span>Import Notebook</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
