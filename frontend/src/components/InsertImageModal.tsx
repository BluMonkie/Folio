import React, { useState, useRef } from "react";
import { api, resolveAssetUrl } from "../api";

interface InsertImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (url: string, altText: string) => void;
}

export const InsertImageModal: React.FC<InsertImageModalProps> = ({
  isOpen,
  onClose,
  onInsert,
}) => {
  const [activeTab, setActiveTab] = useState<"upload" | "url">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [altTextInput, setAltTextInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile.type.startsWith("image/")) {
      setErrorMessage("Please select a valid image file (PNG, JPG, WebP, GIF, SVG).");
      return;
    }
    setErrorMessage(null);
    setFile(selectedFile);
    if (!altTextInput.trim()) {
      // Default alt text to clean filename without extension
      const base = selectedFile.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
      setAltTextInput(base);
    }
    const localUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(localUrl);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (activeTab === "upload") {
      if (!file) {
        setErrorMessage("Please select or drop an image file to upload.");
        return;
      }
      setIsUploading(true);
      try {
        const uploadRes = await api.uploadImage(file);
        const resolved = resolveAssetUrl(uploadRes.url);
        onInsert(resolved, altTextInput.trim() || uploadRes.filename);
        handleClose();
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to upload image. Please try again.");
      } finally {
        setIsUploading(false);
      }
    } else {
      if (!urlInput.trim()) {
        setErrorMessage("Please provide an image URL.");
        return;
      }
      onInsert(urlInput.trim(), altTextInput.trim() || "Image");
      handleClose();
    }
  };

  const handleClose = () => {
    if (previewUrl && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
    setFile(null);
    setPreviewUrl(null);
    setUrlInput("");
    setAltTextInput("");
    setErrorMessage(null);
    setIsUploading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn">
      <div
        className="w-full max-w-lg bg-[#fffdfa] rounded-2xl border border-[#e7e5e4] shadow-2xl overflow-hidden flex flex-col animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#fbf3eb] border-b border-[#f0e6e0]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#f0e6e0] text-[#8d4b00] flex items-center justify-center shadow-2xs">
              <span className="material-symbols-outlined text-[20px]">add_photo_alternate</span>
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#1f1b17] font-serif-editorial">
                Insert Image
              </h2>
              <p className="text-[11px] text-[#78716c]">
                Upload a local image file or embed via web link
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-lg text-[#78716c] hover:text-[#1f1b17] hover:bg-[#eae1da] transition-colors cursor-pointer"
            title="Close dialog"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[#f0e6e0] bg-[#fbf3eb]/60 px-6 pt-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab("upload");
              setErrorMessage(null);
            }}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "upload"
                ? "border-[#d97706] text-[#8d4b00]"
                : "border-transparent text-[#78716c] hover:text-[#1f1b17]"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">upload_file</span>
            <span>Upload Image</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("url");
              setErrorMessage(null);
            }}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "url"
                ? "border-[#d97706] text-[#8d4b00]"
                : "border-transparent text-[#78716c] hover:text-[#1f1b17]"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">link</span>
            <span>Image URL</span>
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {activeTab === "upload" ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif,image/bmp"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFileSelect(e.target.files[0]);
                  }
                }}
              />

              {!previewUrl ? (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                    isDragging
                      ? "border-[#d97706] bg-[#fff8f2]"
                      : "border-[#e7e5e4] hover:border-[#d97706]/70 hover:bg-[#fffcf9]"
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-[#f6ece6] text-[#8d4b00] flex items-center justify-center mb-3">
                    <span className="material-symbols-outlined text-[26px]">cloud_upload</span>
                  </div>
                  <span className="text-xs font-bold text-[#1f1b17]">
                    Click to browse or drag and drop image
                  </span>
                  <span className="text-[11px] text-[#78716c] mt-1">
                    Supports PNG, JPG, WebP, GIF, SVG (Up to 15MB)
                  </span>
                </div>
              ) : (
                <div className="relative rounded-xl border border-[#e7e5e4] bg-[#fcf9f6] p-3 flex items-center gap-4">
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-white border border-[#e7e5e4] shrink-0 flex items-center justify-center">
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#1f1b17] truncate">
                      {file?.name}
                    </p>
                    <p className="text-[10px] text-[#78716c] mt-0.5">
                      {file ? `${(file.size / 1024).toFixed(1)} KB` : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        setPreviewUrl(null);
                      }}
                      className="text-[11px] font-semibold text-[#dc2626] hover:underline mt-2 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                      Remove image
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-[#554336] mb-1.5">
                Image Web Address (URL)
              </label>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://images.unsplash.com/... or /assets/..."
                className="w-full px-3.5 py-2 rounded-lg bg-white border border-[#e7e5e4] text-xs text-[#1f1b17] focus:outline-none focus:border-[#d97706] focus:ring-1 focus:ring-[#d97706] placeholder:text-[#a8a29e]"
                autoFocus
              />
              {urlInput.trim() && (
                <div className="mt-3 p-2 bg-[#fcf9f6] rounded-lg border border-[#e7e5e4] flex items-center justify-center max-h-36 overflow-hidden">
                  <img
                    src={urlInput.trim()}
                    alt="Preview"
                    className="max-h-32 object-contain rounded"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Alt / Caption Text Input */}
          <div>
            <label className="block text-xs font-semibold text-[#554336] mb-1.5">
              Alt Text / Caption (Optional)
            </label>
            <input
              type="text"
              value={altTextInput}
              onChange={(e) => setAltTextInput(e.target.value)}
              placeholder="Descriptive image caption or summary"
              className="w-full px-3.5 py-2 rounded-lg bg-white border border-[#e7e5e4] text-xs text-[#1f1b17] focus:outline-none focus:border-[#d97706] focus:ring-1 focus:ring-[#d97706] placeholder:text-[#a8a29e]"
            />
          </div>

          {/* Dialog Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0e6e0]">
            <button
              type="button"
              onClick={handleClose}
              disabled={isUploading}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-[#554336] hover:bg-[#f6ece6] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading || (activeTab === "upload" && !file) || (activeTab === "url" && !urlInput.trim())}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#d97706] hover:bg-[#b45309] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">add_photo_alternate</span>
                  <span>Insert Image</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
