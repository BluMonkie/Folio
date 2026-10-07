import React, { useState, useEffect, useRef } from "react";
import type { SearchResultItem } from "../api";
import { api } from "../api";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPage: (pageId: number) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  onSelectPage,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.search(query.trim());
        setResults(res.results);
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/25 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl border border-[#e7e5e4] shadow-xl overflow-hidden flex flex-col max-h-[75vh] animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#e7e5e4] bg-[#fcf2eb]">
          <span className="material-symbols-outlined text-[20px] text-[#887364] mr-2.5">
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across all books, titles, and content..."
            className="flex-1 bg-transparent text-[#1f1b17] placeholder:text-[#887364] text-sm focus:outline-none"
          />
          <kbd className="folio-kbd-badge bg-white text-[#78716c] border border-[#e7e5e4]">
            ESC
          </kbd>
        </div>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {loading && (
            <div className="text-center py-8 text-xs text-[#78716c]">
              Searching notes...
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="text-center py-8 text-xs text-[#78716c] italic">
              No results found matching "{query}".
            </div>
          )}

          {!loading && !query && (
            <div className="text-center py-8 text-xs text-[#78716c]">
              Type to search across titles, content, and tags.
            </div>
          )}

          {!loading &&
            results.map((item) => (
              <button
                key={item.page_id}
                onClick={() => {
                  onSelectPage(item.page_id);
                  onClose();
                }}
                className="w-full text-left p-3 rounded-xl hover:bg-[#fcf2eb] transition-colors border border-transparent hover:border-[#e7e5e4] group flex flex-col gap-1 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-[#1f1b17] group-hover:text-[#8d4b00] transition-colors">
                    {item.page_title}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="folio-pill-badge text-[10px] uppercase tracking-wider bg-[#f6ece6] text-[#554336] border border-[#e7e5e4]/70">
                      {item.primary_match}
                    </span>
                    <span className="text-xs text-[#78716c] font-medium">
                      {item.book_title}
                    </span>
                  </div>
                </div>

                {item.snippet && (
                  <p className="text-xs text-[#57534e] line-clamp-2 leading-relaxed">
                    {item.snippet}
                  </p>
                )}

                {item.tags && item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.tags.map((t, idx) => (
                      <span
                        key={idx}
                        className="folio-pill-badge text-[11px] text-[#006a61] bg-[#f0e6e0] font-medium"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
        </div>

        {/* Footer info strip */}
        <div className="px-4 py-2 bg-[#fcf2eb] border-t border-[#e7e5e4] flex items-center justify-between text-[11px] text-[#78716c]">
          <span>Quick search</span>
          <span>Press ESC to close</span>
        </div>
      </div>
    </div>
  );
};
