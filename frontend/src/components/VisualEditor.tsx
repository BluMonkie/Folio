import React, { useState, useEffect, useRef } from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlock from "@tiptap/extension-code-block";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import { api, resolveAssetUrl } from "../api";
import { InsertImageModal } from "./InsertImageModal";

interface VisualEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  onSave?: () => void;
}

/**
 * Preprocesses markdown to convert legacy :::query blocks into ```query code blocks,
 * and strip out any previously mangled escapes (e.g. \* or \() inside queries.
 */
function preprocessForEditor(raw: string): string {
  if (!raw) return "";
  let res = raw.replace(
    /:::+\s*query\s*([\s\S]*?)::+/gi,
    (_match: string, sql: string) => {
      const cleanSql = sql.replace(/\\([*()_`[\]])/g, (_m: string, ch: string) => ch).trim();
      return `\n\n\`\`\`query\n${cleanSql}\n\`\`\`\n\n`;
    }
  );
  return res;
}

/**
 * Custom CodeBlock Node View keeping the exact warm beige ProseMirror look,
 * with a small header indicating the language (or "SQL query").
 */
const CodeBlockComponent: React.FC<any> = ({ node, updateAttributes }) => {
  const language = node.attrs.language || "";
  const isSqlQuery = language === "query" || language === "sql-query";

  return (
    <NodeViewWrapper className="folio-code-card my-3">
      {/* Small header bar on top */}
      <div className="folio-code-header flex items-center justify-between">
        {isSqlQuery ? (
          <span className="font-bold text-[#8d4b00] text-[12px] tracking-wide">SQL query</span>
        ) : (
          <input
            type="text"
            contentEditable={false}
            value={language}
            onChange={(e) => updateAttributes({ language: e.target.value })}
            placeholder="code"
            className="bg-transparent border-none p-0 text-[12px] font-mono font-bold uppercase text-[#554336] focus:outline-none focus:text-[#1f1b17] w-32 placeholder:text-[#a8a29e]"
            title="Code block language"
          />
        )}
      </div>

      {/* Code Area */}
      <pre className="folio-code-pre">
        <NodeViewContent as={"code" as any} />
      </pre>
    </NodeViewWrapper>
  );
};

const CustomCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent);
  },
});

export const VisualEditor: React.FC<VisualEditorProps> = ({
  content,
  onChange,
  onSave,
}) => {
  // Keep track of the last markdown emitted from editor to prevent destructive reset loops
  const lastEmittedRef = useRef<string>(content);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: false, // Replaced by CustomCodeBlock with light header
        bulletList: {},
        orderedList: {},
        bold: {},
        italic: {},
        strike: {},
      }),
      CustomCodeBlock.configure({
        HTMLAttributes: {
          class: "folio-code-block",
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: "folio-editor-image rounded-xl my-4 max-w-full shadow-xs border border-[#e7e5e4]",
        },
      }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: preprocessForEditor(content),
    editorProps: {
      attributes: {
        class: "ProseMirror prose max-w-none text-[#1f1b17] leading-relaxed text-[15px] focus:outline-none min-h-[420px] p-4 sm:p-8",
      },
      handleDrop: (view, event, _slice, moved) => {
        if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
          const droppedFile = event.dataTransfer.files[0];
          if (droppedFile.type.startsWith("image/")) {
            event.preventDefault();
            api.uploadImage(droppedFile).then((res) => {
              const resolved = resolveAssetUrl(res.url);
              const node = view.state.schema.nodes.image.create({
                src: resolved,
                alt: droppedFile.name,
                title: droppedFile.name,
              });
              const transaction = view.state.tr.replaceSelectionWith(node);
              view.dispatch(transaction);
            }).catch((err) => {
              alert(`Failed to upload dropped image: ${err.message || err}`);
            });
            return true;
          }
        }
        return false;
      },
      handlePaste: (view, event) => {
        if (event.clipboardData && event.clipboardData.files && event.clipboardData.files.length > 0) {
          const pastedFile = event.clipboardData.files[0];
          if (pastedFile.type.startsWith("image/")) {
            event.preventDefault();
            api.uploadImage(pastedFile).then((res) => {
              const resolved = resolveAssetUrl(res.url);
              const node = view.state.schema.nodes.image.create({
                src: resolved,
                alt: pastedFile.name,
                title: pastedFile.name,
              });
              const transaction = view.state.tr.replaceSelectionWith(node);
              view.dispatch(transaction);
            }).catch((err) => {
              alert(`Failed to upload pasted image: ${err.message || err}`);
            });
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      let md = (editor.storage as any).markdown?.getMarkdown?.() ?? "";
      md = md.replace(/\\\[\\\[/g, "[[").replace(/\\\]\\\]/g, "]]");
      // Convert ```query blocks back into :::query blocks for storage and read mode
      md = md.replace(/```(?:query|sql-query)\s*([\s\S]*?)```/gi, (_match: string, sql: string) => {
        const cleanSql = sql.replace(/\\([*()_`[\]])/g, (_m: string, ch: string) => ch);
        return `:::query\n${cleanSql.trim()}\n:::`;
      });
      // Also unescape any :::query blocks if present
      md = md.replace(/:::+\s*query\s*([\s\S]*?)::+/gi, (_match: string, sql: string) => {
        const cleanSql = sql.replace(/\\([*()_`[\]])/g, (_m: string, ch: string) => ch);
        return `:::query\n${cleanSql.trim()}\n:::`;
      });
      lastEmittedRef.current = md;
      onChange(md);
    },
  });

  // Only synchronize when content changes from an external source (e.g. mode switch or page change)
  useEffect(() => {
    if (!editor) return;
    // Do not reset while editor is being actively edited by user
    if (content === lastEmittedRef.current) return;
    if (editor.isFocused) return;

    lastEmittedRef.current = content;
    editor.commands.setContent(preprocessForEditor(content));
  }, [content, editor]);

  // Global Ctrl+S / Cmd+S shortcut inside editor
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

  if (!editor) return null;

  const insertSqlBlock = () => {
    editor
      .chain()
      .focus()
      .insertContent([
        {
          type: "codeBlock",
          attrs: { language: "query" },
          content: [
            {
              type: "text",
              text: "SELECT * FROM QueryableTables LIMIT 10;",
            },
          ],
        },
        {
          type: "paragraph",
        },
      ])
      .run();
  };

  const insertWikilink = () => {
    const selection = editor.state.doc.textBetween(
      editor.state.selection.from,
      editor.state.selection.to
    );
    const target = selection || "Note Title";
    editor.chain().focus().insertContent(`[[${target}]]`).run();
  };

  return (
    <div className="flex flex-col bg-white rounded-xl border border-[#e7e5e4] shadow-xs overflow-hidden">
      {/* 1. Explicit Top Formatting Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 bg-[#fcf2eb] border-b border-[#e7e5e4] sticky top-0 z-10 text-xs select-none">
        {/* Headings */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().setParagraph().run()}
          className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
            editor.isActive("paragraph") && !editor.isActive("heading")
              ? "bg-[#d97706] text-white shadow-2xs"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Normal Text (Paragraph)"
        >
          Normal
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`px-2.5 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
            editor.isActive("heading", { level: 1 })
              ? "bg-[#d97706] text-white shadow-2xs"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Heading 1"
        >
          H1
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`px-2.5 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
            editor.isActive("heading", { level: 2 })
              ? "bg-[#d97706] text-white shadow-2xs"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Heading 2"
        >
          H2
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`px-2.5 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
            editor.isActive("heading", { level: 3 })
              ? "bg-[#d97706] text-white shadow-2xs"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Heading 3"
        >
          H3
        </button>

        <div className="w-px h-5 bg-[#e7e5e4] mx-1" />

        {/* Text Formatting */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`px-2.5 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
            editor.isActive("bold")
              ? "bg-[#d97706] text-white shadow-2xs"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Bold (Ctrl+B)"
        >
          B
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`px-2.5 py-1.5 rounded-lg italic font-serif transition-colors cursor-pointer ${
            editor.isActive("italic")
              ? "bg-[#d97706] text-white shadow-2xs"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Italic (Ctrl+I)"
        >
          I
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`px-2.5 py-1.5 rounded-lg line-through transition-colors cursor-pointer ${
            editor.isActive("strike")
              ? "bg-[#d97706] text-white shadow-2xs"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Strikethrough"
        >
          S
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={`px-2 py-1.5 rounded-lg font-mono text-[11px] transition-colors cursor-pointer ${
            editor.isActive("code")
              ? "bg-[#d97706] text-white shadow-2xs"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Inline Code"
        >
          `code`
        </button>

        <div className="w-px h-5 bg-[#e7e5e4] mx-1" />

        {/* Structure: Lists, Quotes & Code Block */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
            editor.isActive("bulletList")
              ? "bg-[#d97706] text-white shadow-2xs font-semibold"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Bullet List"
        >
          • List
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
            editor.isActive("orderedList")
              ? "bg-[#d97706] text-white shadow-2xs font-semibold"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Numbered List"
        >
          1. List
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={`px-2 py-1.5 rounded-lg font-mono text-[11px] transition-colors cursor-pointer ${
            editor.isActive("codeBlock")
              ? "bg-[#d97706] text-white shadow-2xs font-semibold"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Code Block"
        >
          ``` Block
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`px-2.5 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
            editor.isActive("blockquote")
              ? "bg-[#d97706] text-white shadow-2xs font-semibold"
              : "text-[#554336] hover:bg-[#eae1da]"
          }`}
          title="Quote"
        >
          “ Quote
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className="px-2 py-1.5 rounded-lg text-[#554336] hover:bg-[#eae1da] transition-colors cursor-pointer font-bold"
          title="Divider Line"
        >
          —
        </button>

        <div className="w-px h-5 bg-[#e7e5e4] mx-1" />

        {/* Folio Superpowers: SQL Query & Wikilink */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertSqlBlock}
          className="px-2.5 py-1 rounded-lg bg-[#fff8f2] hover:bg-[#f6ece6] border border-[#d97706]/40 text-[#8d4b00] font-semibold transition-colors cursor-pointer"
          title="Insert Live SQL Query Block"
        >
          + SQL Query
        </button>

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertWikilink}
          className="px-2.5 py-1 rounded-lg bg-[#f4f2ff] hover:bg-[#e9e6ff] border border-[#4b41e1]/30 text-[#4b41e1] font-semibold transition-colors cursor-pointer"
          title="Insert [[Wikilink]]"
        >
          + [[Wikilink]]
        </button>

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setIsImageModalOpen(true)}
          className="px-2.5 py-1 rounded-lg bg-[#f0fdf4] hover:bg-[#dcfce7] border border-[#16a34a]/30 text-[#16a34a] font-semibold transition-colors cursor-pointer flex items-center gap-1"
          title="Insert or Upload Image"
        >
          <span className="material-symbols-outlined text-[15px]">add_photo_alternate</span>
          <span>+ Image</span>
        </button>

        <div className="w-px h-5 bg-[#e7e5e4] mx-1 ml-auto" />

        {/* Undo / Redo */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="px-2 py-1 rounded-lg text-[#78716c] hover:bg-[#eae1da] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer font-medium"
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="px-2 py-1 rounded-lg text-[#78716c] hover:bg-[#eae1da] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer font-medium"
          title="Redo (Ctrl+Y)"
        >
          Redo
        </button>
      </div>

      {/* 2. Visual Document Body Canvas */}
      <div className="bg-white min-h-[440px]">
        <EditorContent editor={editor} />
      </div>

      {/* 3. Insert Image Modal */}
      <InsertImageModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        onInsert={(url, altText) => {
          editor
            .chain()
            .focus()
            .setImage({ src: url, alt: altText, title: altText })
            .run();
        }}
      />
    </div>
  );
};
