const RAW_API_BASE: string | undefined = import.meta.env.VITE_API_BASE_URL;

function resolveApiBase(): string {
  if (RAW_API_BASE && RAW_API_BASE.trim()) {
    const cleaned = RAW_API_BASE.trim().replace(/\/$/, "");
    return cleaned.startsWith("http://") || cleaned.startsWith("https://")
      ? cleaned
      : `https://${cleaned}`;
  }
  // In development, default to local backend. In production, warn if unset.
  return import.meta.env.DEV ? "http://127.0.0.1:8000" : "";
}

export const API_BASE = resolveApiBase();

if (typeof window !== "undefined") {
  console.log(`[Folio] API Base: "${API_BASE || '(Unconfigured)'}" | DEV=${import.meta.env.DEV}`);
  if (!API_BASE && !import.meta.env.DEV) {
    console.error(
      "[Folio Error] VITE_API_BASE_URL is not set in Vercel environment variables! Add it in Vercel Project Settings -> Environment Variables and redeploy."
    );
  }
}

// Token management
export function getToken(): string | null {
  return localStorage.getItem("folio_token");
}

export function setToken(token: string): void {
  localStorage.setItem("folio_token", token);
}

export function removeToken(): void {
  localStorage.removeItem("folio_token");
}

let activeShareToken: string | null = null;
export function setShareToken(token: string | null): void {
  activeShareToken = token;
}

export function getShareToken(): string | null {
  return activeShareToken;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  if (!API_BASE && !import.meta.env.DEV) {
    throw new Error(
      "Backend API URL is not configured. Please set VITE_API_BASE_URL in your Vercel Project Settings and redeploy."
    );
  }

  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (activeShareToken) {
    headers["X-Share-Token"] = activeShareToken;
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(errorBody.detail || `Request failed with status ${res.status}`);
    }

    return res.json();
  } catch (err: any) {
    console.error(`[Folio Request Failed] ${API_BASE}${endpoint}:`, err);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Data Types
// -----------------------------------------------------------------------------
export interface UserProfile {
  user_id: number;
  name: string;
  email: string;
  created_at?: string;
}

export interface Book {
  book_id: number;
  owner_id: number;
  owner_name?: string;
  title: string;
  slug: string;
  created_at?: string;
  total_pages: number;
  user_role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
}

export interface PageTreeNode {
  page_id: number;
  parent_page_id: number | null;
  title: string;
  slug: string;
  position: number;
  depth: number;
  breadcrumb: string;
}

export interface PageMetadata {
  page_id: number;
  book_id: number;
  parent_page_id: number | null;
  title: string;
  slug: string;
  position: number;
  content: string;
}

export interface PageRenderData {
  page_id: number;
  book_id: number;
  title: string;
  slug: string;
  raw_content: string;
  html_content: string;
}

export interface BacklinkItem {
  page_id: number;
  title: string;
  slug: string;
}

export interface EditHistoryItem {
  edit_id: number;
  user_id: number | null;
  user_name: string | null;
  edit_time: string;
  action: string;
  snapshot: string;
}

export interface PageGrantItem {
  table_id: number;
  table_name: string;
  db: string;
  can_read: boolean;
  can_write: boolean;
  source_tier: "PAGE" | "BOOK" | "NONE";
  is_override: boolean;
  page_grant_id?: number | null;
  book_grant_id?: number | null;
}

export interface TagItem {
  tag_id: number;
  name: string;
}

export interface SearchResultItem {
  page_id: number;
  book_id: number;
  book_title: string;
  book_slug: string;
  page_title: string;
  page_slug: string;
  tags: string[];
  relevance_score: number;
  primary_match: "TITLE" | "TAG" | "CONTENT";
  snippet?: string | null;
}

export interface TableItem {
  table_id: number;
  table_name: string;
  db: string;
  is_system: boolean;
  row_count: number;
  column_count: number;
}

export interface ColumnSchemaItem {
  name: string;
  data_type: string;
  full_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  default: string | null;
  extra: string | null;
}

export interface TableSchemaResponse {
  table_name: string;
  db: string;
  is_system: boolean;
  primary_keys: string[];
  columns: ColumnSchemaItem[];
}

export interface TableDataResponse {
  table_name: string;
  total_rows: number;
  page: number;
  limit: number;
  columns: string[];
  rows: Record<string, any>[];
}

export interface BookGrantItem {
  grant_id: number;
  book_id: number;
  table_id: number;
  table_name: string;
  db: string;
  can_read: boolean;
  can_write: boolean;
}

export interface QueryableTableItem {
  table_id: number;
  table_name: string;
  db: string;
}

export interface BookImportResponse {
  book_id: number;
  title: string;
  slug: string;
  pages_imported: number;
  tags_restored: number;
  grants_restored: number;
  grants_requested: boolean;
  skipped_grants: string[];
  message: string;
}

export interface BookPublishInfo {
  book_id: number;
  is_published: boolean;
  share_token: string | null;
  access_mode: "VIEWER" | "EDITOR";
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AssetUploadResponse {
  url: string;
  filename: string;
  content_type: string;
  size: number;
}

export interface PublicBookView {
  book_id: number;
  title: string;
  slug: string;
  owner_name: string;
  access_mode: "VIEWER" | "EDITOR";
  share_token: string;
  tree: PageTreeNode[];
}

export interface PublicPageRender {
  page_id: number;
  book_id: number;
  title: string;
  slug: string;
  raw_content: string;
  html_content: string;
  tags: TagItem[];
  backlinks: BacklinkItem[];
}

// -----------------------------------------------------------------------------
// API Services
// -----------------------------------------------------------------------------
export const api = {
  // Auth
  async login(email: string, password: string): Promise<{ access_token: string; user: UserProfile }> {
    const data = await request<{ access_token: string; user: UserProfile }>("/auth/login/json", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(data.access_token);
    return data;
  },

  async signup(name: string, email: string, password: string): Promise<{ access_token: string; user: UserProfile }> {
    const data = await request<{ access_token: string; user: UserProfile }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    setToken(data.access_token);
    return data;
  },

  logout(): void {
    removeToken();
  },

  async getMe(): Promise<UserProfile> {
    return request<UserProfile>("/auth/me");
  },

  // Books
  async listBooks(): Promise<Book[]> {
    return request<Book[]>("/books");
  },

  async createBook(title: string, slug?: string): Promise<Book> {
    return request<Book>("/books", {
      method: "POST",
      body: JSON.stringify({ title, slug }),
    });
  },

  async getBookTree(bookId: number): Promise<PageTreeNode[]> {
    return request<PageTreeNode[]>(`/books/${bookId}/tree`);
  },

  async updateBook(bookId: number, data: { title?: string; slug?: string }): Promise<Book> {
    return request<Book>(`/books/${bookId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deleteBook(bookId: number): Promise<{ message: string }> {
    return request<{ message: string }>(`/books/${bookId}`, {
      method: "DELETE",
    });
  },

  async exportBook(bookId: number): Promise<Blob> {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/books/${bookId}/export`, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Export failed" }));
      throw new Error(err.detail || "Failed to export notebook");
    }
    return res.blob();
  },

  async importBook(formData: FormData): Promise<BookImportResponse> {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/books/import`, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Import failed" }));
      throw new Error(err.detail || "Failed to import notebook");
    }
    return res.json();
  },

  // Book Publishing & Public Sharing
  async getBookPublish(bookId: number): Promise<BookPublishInfo> {
    return request<BookPublishInfo>(`/books/${bookId}/publish`);
  },

  async updateBookPublish(bookId: number, data: { is_published: boolean; access_mode: "VIEWER" | "EDITOR" }): Promise<BookPublishInfo> {
    return request<BookPublishInfo>(`/books/${bookId}/publish`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async getPublicBook(shareToken: string): Promise<PublicBookView> {
    return request<PublicBookView>(`/public/books/${shareToken}`);
  },

  async getPublicPage(shareToken: string, pageId: number): Promise<PublicPageRender> {
    return request<PublicPageRender>(`/public/pages/${shareToken}/${pageId}`);
  },

  // Pages
  async getPage(pageId: number): Promise<PageMetadata> {
    return request<PageMetadata>(`/pages/${pageId}`);
  },

  async getPageRender(pageId: number): Promise<PageRenderData> {
    return request<PageRenderData>(`/pages/${pageId}/render`);
  },

  async createPage(bookId: number, data: { title: string; parent_page_id?: number | null; content?: string }): Promise<PageMetadata> {
    return request<PageMetadata>(`/books/${bookId}/pages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updatePage(pageId: number, data: { title?: string; slug?: string; content?: string; parent_page_id?: number | null; position?: number }): Promise<PageMetadata> {
    return request<PageMetadata>(`/pages/${pageId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async movePage(pageId: number, data: { target_page_id?: number | null; drop_position: "before" | "after" | "inside" }): Promise<PageMetadata> {
    return request<PageMetadata>(`/pages/${pageId}/move`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async deletePage(pageId: number): Promise<{ message: string }> {
    return request<{ message: string }>(`/pages/${pageId}`, {
      method: "DELETE",
    });
  },

  async getPageBacklinks(pageId: number): Promise<BacklinkItem[]> {
    return request<BacklinkItem[]>(`/pages/${pageId}/backlinks`);
  },

  async getPageHistory(pageId: number): Promise<EditHistoryItem[]> {
    return request<EditHistoryItem[]>(`/pages/${pageId}/history`);
  },

  async restorePageVersion(pageId: number, editId: number): Promise<PageRenderData> {
    return request<PageRenderData>(`/pages/${pageId}/restore/${editId}`, {
      method: "POST",
    });
  },

  async getPageGrants(pageId: number): Promise<PageGrantItem[]> {
    return request<PageGrantItem[]>(`/pages/${pageId}/grants`);
  },

  async getPageTags(pageId: number): Promise<TagItem[]> {
    return request<TagItem[]>(`/pages/${pageId}/tags`);
  },

  async addPageTag(pageId: number, name: string): Promise<TagItem> {
    return request<TagItem>(`/pages/${pageId}/tags`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  async removePageTag(pageId: number, tagId: number): Promise<{ message: string }> {
    return request<{ message: string }>(`/pages/${pageId}/tags/${tagId}`, {
      method: "DELETE",
    });
  },

  async listAllTags(): Promise<TagItem[]> {
    return request<TagItem[]>("/tags");
  },

  // Search
  async search(query: string, bookId?: number): Promise<{ results: SearchResultItem[]; total_results: number }> {
    const params = new URLSearchParams({ q: query });
    if (bookId) params.append("book_id", bookId.toString());
    return request(`/search?${params.toString()}`);
  },

  // Tables & Data Studio
  async listTables(): Promise<TableItem[]> {
    return request<TableItem[]>("/tables");
  },

  async getTableSchema(tableName: string): Promise<TableSchemaResponse> {
    return request<TableSchemaResponse>(`/tables/${tableName}/schema`);
  },

  async getTableData(
    tableName: string,
    page = 1,
    limit = 25,
    sortBy?: string,
    sortDir = "asc",
    search?: string
  ): Promise<TableDataResponse> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      sort_dir: sortDir,
    });
    if (sortBy) params.append("sort_by", sortBy);
    if (search) params.append("search", search);
    return request<TableDataResponse>(`/tables/${tableName}/data?${params.toString()}`);
  },

  async createTable(
    tableName: string,
    columns: { name: string; type: string; primary_key?: boolean; auto_increment?: boolean; nullable?: boolean; default?: string }[]
  ): Promise<any> {
    return request("/tables", {
      method: "POST",
      body: JSON.stringify({ table_name: tableName, columns }),
    });
  },

  async addColumn(
    tableName: string,
    column: { name: string; type: string; nullable?: boolean; default?: string }
  ): Promise<any> {
    return request(`/tables/${tableName}/columns`, {
      method: "POST",
      body: JSON.stringify(column),
    });
  },

  async dropColumn(tableName: string, columnName: string): Promise<any> {
    return request(`/tables/${tableName}/columns/${columnName}`, {
      method: "DELETE",
    });
  },

  async insertRow(tableName: string, data: Record<string, any>): Promise<any> {
    return request(`/tables/${tableName}/rows`, {
      method: "POST",
      body: JSON.stringify({ data }),
    });
  },

  async updateRow(tableName: string, primaryKey: Record<string, any>, data: Record<string, any>): Promise<any> {
    return request(`/tables/${tableName}/rows`, {
      method: "PUT",
      body: JSON.stringify({ primary_key: primaryKey, data }),
    });
  },

  async deleteRow(tableName: string, primaryKey: Record<string, any>): Promise<any> {
    return request(`/tables/${tableName}/rows`, {
      method: "DELETE",
      body: JSON.stringify({ primary_key: primaryKey }),
    });
  },

  async importCsv(tableName: string, csvText: string): Promise<any> {
    return request(`/tables/${tableName}/import-csv`, {
      method: "POST",
      body: JSON.stringify({ csv_text: csvText }),
    });
  },

  async createTableFromCsv(tableName: string, csvText: string): Promise<any> {
    return request("/tables/create-from-csv", {
      method: "POST",
      body: JSON.stringify({ table_name: tableName, csv_text: csvText }),
    });
  },

  async dropTable(tableName: string): Promise<any> {
    return request(`/tables/${tableName}`, {
      method: "DELETE",
    });
  },

  // Grants Management
  async listQueryableTables(): Promise<QueryableTableItem[]> {
    return request<QueryableTableItem[]>("/queryable-tables");
  },

  async listBookGrants(bookId: number): Promise<BookGrantItem[]> {
    return request<BookGrantItem[]>(`/books/${bookId}/grants`);
  },

  async grantTableToBook(bookId: number, tableId: number, canRead = true, canWrite = false): Promise<BookGrantItem> {
    return request<BookGrantItem>(`/books/${bookId}/grants`, {
      method: "POST",
      body: JSON.stringify({ table_id: tableId, can_read: canRead, can_write: canWrite }),
    });
  },

  async revokeBookGrant(bookId: number, grantId: number): Promise<{ message: string }> {
    return request<{ message: string }>(`/books/${bookId}/grants/${grantId}`, {
      method: "DELETE",
    });
  },

  async grantTableToPage(pageId: number, tableId: number, canRead = true, canWrite = false): Promise<PageGrantItem> {
    return request<PageGrantItem>(`/pages/${pageId}/grants`, {
      method: "POST",
      body: JSON.stringify({ table_id: tableId, can_read: canRead, can_write: canWrite }),
    });
  },

  async revokePageGrant(pageId: number, grantId: number): Promise<{ message: string }> {
    return request<{ message: string }>(`/pages/${pageId}/grants/${grantId}`, {
      method: "DELETE",
    });
  },

  // Assets / Images Upload
  async uploadImage(file: File): Promise<AssetUploadResponse> {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (activeShareToken) headers["X-Share-Token"] = activeShareToken;

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${API_BASE}/api/assets/upload`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Image upload failed" }));
      throw new Error(err.detail || "Failed to upload image");
    }

    return res.json();
  },
};

export function resolveAssetUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  if (url.startsWith("/assets/")) {
    return API_BASE ? `${API_BASE}${url}` : url;
  }
  return url;
}

export async function downloadBookExport(bookId: number): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/books/${bookId}/export`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Export failed" }));
    throw new Error(err.detail || "Failed to export notebook");
  }
  const blob = await res.blob();
  let filename = `notebook-${bookId}.zip`;
  const disposition = res.headers.get("Content-Disposition");
  if (disposition && disposition.includes("filename=")) {
    const match = disposition.match(/filename="?([^"]+)"?/);
    if (match && match[1]) filename = match[1];
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return filename;
}
