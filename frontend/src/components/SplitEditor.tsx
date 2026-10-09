import React, { useState, useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { marked } from "marked";
import { api, resolveAssetUrl } from "../api";
import { InsertImageModal } from "./InsertImageModal";

interface SplitEditorProps {
  content: string;
  onChange: (value: string) => void;
  renderedHtml: string;
  savedContent: string;
  onSave?: () => void;
  onNavigatePage?: (pageId: number) => void;
}

export const SplitEditor: React.FC<SplitEditorProps> = ({
  content,
  onChange,
  renderedHtml,
  savedContent,
  onSave,
  onNavigatePage,
}) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  // Live client-side compilation of Markdown as the user types
  const liveHtml = useMemo(() => {
    // If user hasn't modified content from saved file, display full backend-rendered HTML (with executed MySQL query tables)
    if (content === savedContent && renderedHtml) {
      return renderedHtml;
    }

    if (!content.trim()) {
      return "<p class='text-[#78716c] italic'>Start typing markdown on the left...</p>";
    }

    // Safely preprocess :::query and ```query blocks into live visual preview cards,
    // protecting code blocks (`...` and ```...```) and handling backslash escapes (\:::query)
    const QUERY_SCANNER = /(^[ \t]*(?:`{3,}|~{3,})[ \t]*([^\r\n`]*)\r?\n[\s\S]*?\r?\n[ \t]*(?:`{3,}|~{3,})[ \t]*(?:\r?\n|$))|(`+[\s\S]*?`+)|(\\+)(:::+\s*query\b[\s\S]*?(?:\\:::+|:::+))|(\\+)(:::+\s*query\b)|(:::+\s*query\b([\s\S]*?):::+)/gim;

    let preprocessed = content.replace(
      QUERY_SCANNER,
      (match, fenced, lang, inline, escSlashes1, escBody1, escSlashes2, escBody2, colonMatch, colonSql) => {
        // 1. Fenced code block (preserve unless active query fence)
        if (fenced) {
          const cleanLang = (lang || "").trim().toLowerCase();
          if (cleanLang === "query" || cleanLang === "sql-query") {
            const sql = fenced
              .replace(/^[ \t]*(?:`{3,}|~{3,})[^\r\n`]*\r?\n/, "")
              .replace(/\r?\n[ \t]*(?:`{3,}|~{3,})[ \t]*(?:\r?\n|$)/, "");
            return `\n\n<div class="folio-query-box">
              <div class="folio-query-header">
                <span class="folio-badge folio-badge-info">SQL QUERY BLOCK</span>
              </div>
              <div class="folio-query-body">
                <pre class="folio-sql-preview"><code>${sql.trim()}</code></pre>
              </div>
            </div>\n\n`;
          }
          return fenced;
        }

        // 2. Inline code span: preserve completely
        if (inline) {
          return inline;
        }

        // 3. Escaped colon query block: e.g. \:::query ... :::
        if (escSlashes1) {
          if (escSlashes1.length % 2 === 1) {
            return escSlashes1.slice(0, -1) + escBody1.replace(/\\(:::+)/g, "$1");
          }
          const rawSql = escBody1.replace(/^:::+\s*query\b/i, "").replace(/:::+$/, "").trim();
          const prefix = escSlashes1.slice(0, escSlashes1.length / 2);
          return `${prefix}\n\n<div class="folio-query-box">
              <div class="folio-query-header">
                <span class="folio-badge folio-badge-info">SQL QUERY BLOCK</span>
              </div>
              <div class="folio-query-body">
                <pre class="folio-sql-preview"><code>${rawSql}</code></pre>
              </div>
            </div>\n\n`;
        }

        // 4. Escaped single \:::query
        if (escSlashes2) {
          if (escSlashes2.length % 2 === 1) {
            return escSlashes2.slice(0, -1) + escBody2;
          }
          return escSlashes2.slice(0, escSlashes2.length / 2) + escBody2;
        }

        // 5. Active colon query block
        if (colonMatch) {
          const trimmedSql = (colonSql || "").trim();
          return `\n\n<div class="folio-query-box">
            <div class="folio-query-header">
              <span class="folio-badge folio-badge-info">SQL QUERY BLOCK</span>
            </div>
            <div class="folio-query-body">
              <pre class="folio-sql-preview"><code>${trimmedSql}</code></pre>
            </div>
          </div>\n\n`;
        }

        return match;
      }
    );

    // Safely preprocess [[wikilinks]] without altering code blocks or inline code
    const WL_SCANNER = /(^[ \t]*(?:`{3,}|~{3,})[^\r\n`]*\r?\n[\s\S]*?\r?\n[ \t]*(?:`{3,}|~{3,})[ \t]*(?:\r?\n|$))|(`+[\s\S]*?`+)|(\\+)\[\[([^\]|\\]+)(?:\|([^\]\\]+))?\]\]|\[\[([^\]|\\]+)(?:\|([^\]\\]+))?\]\]/gim;

    preprocessed = preprocessed.replace(
      WL_SCANNER,
      (match, fenced, inline, escSlashes, escTarget, escLabel, wlTarget, wlLabel) => {
        if (fenced || inline) return match;
        if (escSlashes) {
          const label = (escLabel || escTarget || "").trim();
          if (escSlashes.length % 2 === 1) {
            return `${escSlashes.slice(0, -1)}[[${label}]]`;
          }
          const prefix = escSlashes.slice(0, escSlashes.length / 2);
          return `${prefix}<span class="folio-wikilink">${label}</span>`;
        }
        if (wlTarget) {
          const text = (wlLabel || wlTarget || "").trim();
          return `<span class="folio-wikilink">${text}</span>`;
        }
        return match;
      }
    );

    try {
      let parsed = marked.parse(preprocessed, { gfm: true, breaks: true }) as string;
      parsed = parsed.replace(
        /<pre[^>]*><code(?:\s+class="language-([^">]+)")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
        (_match, lang, code) => {
          const langDisplay = (lang || "code").trim().toUpperCase();
          return `<div class="folio-code-card">
            <div class="folio-code-header">${langDisplay}</div>
            <pre class="folio-code-pre"><code>${code}</code></pre>
          </div>`;
        }
      );

      // Wrap markdown tables in identical folio-query-box styling
      parsed = parsed.replace(
        /<table(?:\s+[^>]*)?>([\s\S]*?)<\/table>/gi,
        (_match, tableInner) => {
          return `<div class="folio-query-box folio-markdown-table-box">
            <div class="folio-table-wrapper">
              <table class="folio-data-table">${tableInner}</table>
            </div>
          </div>`;
        }
      );

      return parsed;
    } catch (err) {
      return `<pre class="text-red-600">Markdown Parse Error: ${err}</pre>`;
    }
  }, [content, savedContent, renderedHtml]);

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (onSave) onSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSave]);

  // Intercept wikilink clicks inside the preview
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !onNavigatePage) return;

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
  }, [liveHtml, onNavigatePage]);

  // Quick insertion helper
  const insertText = (snippet: string) => {
    onChange(content + snippet);
  };

  const insertSqlBlock = () => {
    const sample = `\n\n:::query\nSELECT * FROM QueryableTables LIMIT 10;\n:::\n`;
    insertText(sample);
  };

  const insertWikilink = () => {
    insertText(` [[Note Title]]`);
  };

  const insertTableBlock = () => {
    const tableTemplate = `\n\n| Column 1 | Column 2 | Column 3 |\n| :--- | :--- | :--- |\n| Row 1 Data | Value A | 100 |\n| Row 2 Data | Value B | 200 |\n\n`;
    insertText(tableTemplate);
  };

  const insertImage = (url: string, altText: string) => {
    const snippet = `\n\n![${altText || "Image"}](${url})\n\n`;
    onChange(content + snippet);
  };

  const handleEditorDrop = (e: React.DragEvent) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type.startsWith("image/")) {
        e.preventDefault();
        api.uploadImage(droppedFile).then((res) => {
          const resolved = resolveAssetUrl(res.url);
          insertImage(resolved, droppedFile.name);
        }).catch((err) => {
          alert(`Failed to upload dropped image: ${err.message || err}`);
        });
      }
    }
  };

  const handleEditorPaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      const pastedFile = e.clipboardData.files[0];
      if (pastedFile.type.startsWith("image/")) {
        e.preventDefault();
        api.uploadImage(pastedFile).then((res) => {
          const resolved = resolveAssetUrl(res.url);
          insertImage(resolved, pastedFile.name);
        }).catch((err) => {
          alert(`Failed to upload pasted image: ${err.message || err}`);
        });
      }
    }
  };

  return (
    <div className="flex flex-col bg-white rounded-xl border border-[#e7e5e4] shadow-xs overflow-hidden">
      {/* Helper Insertion Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-[#fcf2eb] border-b border-[#e7e5e4] text-xs">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => insertText("\n# ")}
            className="px-2 py-1 rounded bg-white hover:bg-[#eae1da] border border-[#e7e5e4] text-[#1f1b17] font-semibold cursor-pointer"
            title="Insert H1"
          >
            # H1
          </button>
          <button
            type="button"
            onClick={() => insertText("\n## ")}
            className="px-2 py-1 rounded bg-white hover:bg-[#eae1da] border border-[#e7e5e4] text-[#1f1b17] font-semibold cursor-pointer"
            title="Insert H2"
          >
            ## H2
          </button>
          <button
            type="button"
            onClick={() => insertText("**bold**")}
            className="px-2 py-1 rounded bg-white hover:bg-[#eae1da] border border-[#e7e5e4] text-[#1f1b17] font-bold cursor-pointer"
            title="Bold"
          >
            **B**
          </button>
          <button
            type="button"
            onClick={() => insertText("*italic*")}
            className="px-2 py-1 rounded bg-white hover:bg-[#eae1da] border border-[#e7e5e4] text-[#1f1b17] italic cursor-pointer font-serif"
            title="Italic"
          >
            *I*
          </button>
          <button
            type="button"
            onClick={() => insertText("\n- ")}
            className="px-2 py-1 rounded bg-white hover:bg-[#eae1da] border border-[#e7e5e4] text-[#1f1b17] font-medium cursor-pointer"
            title="List"
          >
            - List
          </button>
          <button
            type="button"
            onClick={() => insertText("\n```\ncode\n```\n")}
            className="px-2 py-1 rounded bg-white hover:bg-[#eae1da] border border-[#e7e5e4] text-[#1f1b17] font-mono text-[11px] cursor-pointer"
            title="Code Block"
          >
            ``` Code
          </button>
        </div>

        <div className="flex items-center gap-2 mt-1 sm:mt-0">
          <button
            type="button"
            onClick={insertSqlBlock}
            className="px-2.5 py-1 rounded-lg bg-[#fff8f2] hover:bg-[#f6ece6] border border-[#d97706]/40 text-[#8d4b00] font-semibold transition-colors cursor-pointer"
            title="Insert SQL Query Block"
          >
            + SQL Query
          </button>

          <button
            type="button"
            onClick={insertTableBlock}
            className="px-2.5 py-1 rounded-lg bg-[#f0f9ff] hover:bg-[#e0f2fe] border border-[#0284c7]/30 text-[#0284c7] font-semibold transition-colors cursor-pointer flex items-center gap-1"
            title="Insert Markdown Table"
          >
            <span className="material-symbols-outlined text-[15px]">table_chart</span>
            <span>+ Table</span>
          </button>

          <button
            type="button"
            onClick={insertWikilink}
            className="px-2.5 py-1 rounded-lg bg-[#f4f2ff] hover:bg-[#e9e6ff] border border-[#4b41e1]/30 text-[#4b41e1] font-semibold transition-colors cursor-pointer"
            title="Insert [[Wikilink]]"
          >
            + [[Wikilink]]
          </button>

          <button
            type="button"
            onClick={() => setIsImageModalOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-[#f0fdf4] hover:bg-[#dcfce7] border border-[#16a34a]/30 text-[#16a34a] font-semibold transition-colors cursor-pointer flex items-center gap-1"
            title="Insert or Upload Image"
          >
            <span className="material-symbols-outlined text-[15px]">add_photo_alternate</span>
            <span>+ Image</span>
          </button>
        </div>
      </div>

      {/* Side-by-Side Split Panes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#e7e5e4] min-h-[520px]">
        {/* Left Pane: CodeMirror Markdown Editor */}
        <div
          className="flex flex-col bg-[#fcfbfa]"
          onDrop={handleEditorDrop}
          onPaste={handleEditorPaste}
        >
          <div className="px-3.5 py-1.5 bg-[#f6ece6] border-b border-[#e7e5e4] text-[11px] font-semibold text-[#78716c] flex items-center justify-between select-none">
            <span>Editor</span>
            <span className="font-mono text-[10px] text-[#a8a29e]">Markdown</span>
          </div>
          <div className="flex-1 overflow-auto p-2">
            <CodeMirror
              value={content}
              height="500px"
              extensions={[markdown()]}
              onChange={(value) => onChange(value)}
              theme="light"
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                history: true,
                foldGutter: true,
                drawSelection: true,
                bracketMatching: true,
                closeBrackets: true,
                highlightActiveLine: true,
              }}
              className="text-sm font-mono-editorial"
            />
          </div>
        </div>

        {/* Right Pane: Real-time Live Compiled Preview */}
        <div className="flex flex-col bg-white">
          <div className="px-3.5 py-1.5 bg-[#f6ece6] border-b border-[#e7e5e4] text-[11px] font-semibold text-[#78716c] flex items-center justify-between select-none">
            <span>Live Preview</span>
            {content !== savedContent && (
              <span className="text-[10px] text-[#d97706] font-medium">Updating live</span>
            )}
          </div>
          <div
            ref={previewRef}
            className="flex-1 overflow-auto p-5 sm:p-8 prose max-w-none text-[#1f1b17] leading-relaxed text-[15px] space-y-4"
            dangerouslySetInnerHTML={{ __html: liveHtml }}
          />
        </div>
      </div>

      {/* Insert Image Modal */}
      <InsertImageModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        onInsert={(url, altText) => insertImage(url, altText)}
      />
    </div>
  );
};
