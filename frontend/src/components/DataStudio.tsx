import React, { useState, useEffect, useCallback } from "react";
import {
  api,
  type TableItem,
  type TableSchemaResponse,
  type TableDataResponse
} from "../api";

interface DataStudioProps {
  onBackToBookshelf?: () => void;
}

export function DataStudio({ onBackToBookshelf }: DataStudioProps) {
  const [tables, setTables] = useState<TableItem[]>([]);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null);
  const [searchTableQuery, setSearchTableQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"data" | "schema">("data");
  const [loadingTables, setLoadingTables] = useState(false);

  // Schema state
  const [schema, setSchema] = useState<TableSchemaResponse | null>(null);

  // Data state
  const [dataResponse, setDataResponse] = useState<TableDataResponse | null>(null);
  const [page, setPage] = useState(1);
  const [searchDataQuery, setSearchDataQuery] = useState("");
  const [sortBy, setSortBy] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [loadingData, setLoadingData] = useState(false);

  // Modals state
  const [isCreateTableOpen, setIsCreateTableOpen] = useState(false);
  const [isImportCsvOpen, setIsImportCsvOpen] = useState(false);
  const [isAddRowOpen, setIsAddRowOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Record<string, any> | null>(null);
  const [isAddColumnOpen, setIsAddColumnOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 1. Load Tables
  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    try {
      const list = await api.listTables();
      setTables(list);
      if (list.length > 0 && !selectedTableName) {
        setSelectedTableName(list[0].table_name);
      }
    } catch (err: any) {
      console.error("Failed to load tables:", err);
    } finally {
      setLoadingTables(false);
    }
  }, [selectedTableName]);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  // 2. Load Selected Table Details (Schema & Data)
  const loadTableDetails = useCallback(async (tableName: string, p = 1, search = searchDataQuery) => {
    setLoadingData(true);
    try {
      const [sch, data] = await Promise.all([
        api.getTableSchema(tableName),
        api.getTableData(tableName, p, 25, sortBy, sortDir, search)
      ]);
      setSchema(sch);
      setDataResponse(data);
      setPage(p);
    } catch (err: any) {
      console.error("Failed to load table details:", err);
    } finally {
      setLoadingData(false);
    }
  }, [sortBy, sortDir, searchDataQuery]);

  useEffect(() => {
    if (selectedTableName) {
      loadTableDetails(selectedTableName, 1);
    }
  }, [selectedTableName, sortBy, sortDir]);

  const handleSelectTable = (name: string) => {
    setSelectedTableName(name);
    setSearchDataQuery("");
    setSortBy(undefined);
    setSortDir("asc");
  };

  const handleDataSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTableName) {
      loadTableDetails(selectedTableName, 1, searchDataQuery);
    }
  };

  const handleSort = (colName: string) => {
    if (sortBy === colName) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(colName);
      setSortDir("asc");
    }
  };

  const handleDeleteRow = async (row: Record<string, any>) => {
    if (!schema || !selectedTableName) return;
    const pkKeys = schema.primary_keys.length > 0 ? schema.primary_keys : ["id"];
    const pkData: Record<string, any> = {};
    for (const k of pkKeys) {
      if (row[k] !== undefined) {
        pkData[k] = row[k];
      }
    }

    if (Object.keys(pkData).length === 0) {
      alert("Cannot delete: no primary key identified for this row.");
      return;
    }

    if (!window.confirm("Are you sure you want to delete this row?")) return;

    try {
      await api.deleteRow(selectedTableName, pkData);
      showToast("Row deleted successfully");
      loadTableDetails(selectedTableName, page);
    } catch (err: any) {
      alert(`Delete failed: ${err.message || err}`);
    }
  };

  const handleDeleteTable = async () => {
    if (!selectedTableName) return;
    if (!window.confirm(`Are you sure you want to permanently DROP table '${selectedTableName}'? This will delete all rows and associated grants.`)) {
      return;
    }
    try {
      await api.dropTable(selectedTableName);
      showToast(`Table '${selectedTableName}' dropped`);
      setSelectedTableName(null);
      await loadTables();
    } catch (err: any) {
      alert(`Drop table failed: ${err.message || err}`);
    }
  };

  const filteredTables = tables.filter((t) =>
    t.table_name.toLowerCase().includes(searchTableQuery.toLowerCase())
  );

  return (
    <div className="flex h-full w-full bg-[#fcf8f5] text-[#1f1b17] overflow-hidden font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1f1b17] text-white px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 animate-fadeIn pointer-events-none">
          <span className="material-symbols-outlined text-[18px] text-[#fbbf24]">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 1. Left Tables Sidebar / Catalog */}
      <aside className="w-72 bg-white border-r border-[#e7e5e4] flex flex-col shrink-0">
        {/* Header */}
        <div className="p-3.5 border-b border-[#f0e6e0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBackToBookshelf && (
              <button
                type="button"
                onClick={onBackToBookshelf}
                className="p-1 rounded-lg text-[#78716c] hover:text-[#1f1b17] hover:bg-[#f6ece6] cursor-pointer"
                title="Back to Bookshelf"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              </button>
            )}
            <span className="material-symbols-outlined text-[20px] text-[#8d4b00]">dataset</span>
            <span className="font-bold text-sm text-[#1f1b17]">Data Tables</span>
          </div>
          <span className="folio-pill-badge bg-[#f6ece6] text-[#78716c] text-[11px] font-semibold">
            {tables.length}
          </span>
        </div>

        {/* Action Buttons: New Table & Import CSV */}
        <div className="p-3 border-b border-[#f0e6e0] grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setIsCreateTableOpen(true)}
            className="flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px]">add</span>
            <span>New Table</span>
          </button>
          <button
            type="button"
            onClick={() => setIsImportCsvOpen(true)}
            className="flex items-center justify-center gap-1.5 h-8 px-2 rounded-lg bg-[#f6ece6] hover:bg-[#eae1da] text-[#554336] text-xs font-semibold border border-[#e7e5e4] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[15px]">upload_file</span>
            <span>Import CSV</span>
          </button>
        </div>

        {/* Filter Input */}
        <div className="px-3 py-2 border-b border-[#f0e6e0]">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-2 text-[16px] text-[#a8a29e]">
              search
            </span>
            <input
              type="text"
              value={searchTableQuery}
              onChange={(e) => setSearchTableQuery(e.target.value)}
              placeholder="Filter tables..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[#fdf9f6] border border-[#e7e5e4] focus:outline-none focus:border-[#d97706] text-[#1f1b17]"
            />
          </div>
        </div>

        {/* Tables List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredTables.length === 0 ? (
            <div className="p-4 text-center text-xs text-[#78716c] italic">
              {loadingTables ? "Loading tables..." : "No tables found."}
            </div>
          ) : (
            filteredTables.map((t) => {
              const isSelected = selectedTableName === t.table_name;
              return (
                <button
                  key={t.table_id}
                  type="button"
                  onClick={() => handleSelectTable(t.table_name)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors text-left cursor-pointer group ${
                    isSelected
                      ? "bg-[#f6ece6] text-[#8d4b00] font-semibold border border-[#e7e5e4]"
                      : "text-[#554336] hover:bg-[#fdf9f6] hover:text-[#1f1b17]"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="material-symbols-outlined text-[17px] text-[#8d4b00] shrink-0">
                      table_chart
                    </span>
                    <span className="truncate">{t.table_name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-1">
                    <span className="text-[10px] text-[#a8a29e] font-mono">
                      {t.row_count} rows
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* 2. Main Studio Canvas */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-white">
        {!selectedTableName ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#78716c]">
            <span className="material-symbols-outlined text-[48px] text-[#d97706] mb-3">
              dataset
            </span>
            <h2 className="text-lg font-bold text-[#1f1b17] font-serif-editorial">
              Folio Data Explorer
            </h2>
            <p className="text-xs max-w-sm mt-1 leading-relaxed">
              Select an accessible MySQL table from the catalog or create a new table / import CSV to inspect and query records.
            </p>
          </div>
        ) : (
          <>
            {/* Table Header Bar */}
            <header className="px-6 py-4 border-b border-[#e7e5e4] flex items-center justify-between shrink-0 bg-[#fdf9f6]">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-[#1f1b17] font-mono">
                    {selectedTableName}
                  </h2>
                  {schema?.is_system && (
                    <span className="folio-pill-badge bg-blue-50 text-blue-700 border border-blue-200 text-[10px]">
                      System
                    </span>
                  )}
                  <span className="folio-pill-badge bg-[#f0e6e0] text-[#554336] text-[10px]">
                    {schema?.db || "folio_db"}
                  </span>
                </div>
                <div className="text-xs text-[#78716c] mt-1 flex items-center gap-3">
                  <span>{dataResponse?.total_rows ?? 0} total records</span>
                  <span>•</span>
                  <span>{schema?.columns.length ?? 0} columns</span>
                </div>
              </div>

              {/* Header Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddRowOpen(true)}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  <span>Add Row</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsImportCsvOpen(true)}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white hover:bg-[#f6ece6] text-[#554336] text-xs font-semibold border border-[#e7e5e4] transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">upload_file</span>
                  <span>Import CSV</span>
                </button>
                {!schema?.is_system && (
                  <button
                    type="button"
                    onClick={handleDeleteTable}
                    className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 text-xs font-semibold transition-colors cursor-pointer"
                    title="Drop table"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                    <span>Drop Table</span>
                  </button>
                )}
              </div>
            </header>

            {/* View Switcher: Data vs Schema */}
            <div className="px-6 border-b border-[#e7e5e4] flex items-center justify-between bg-white shrink-0">
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setActiveTab("data")}
                  className={`py-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                    activeTab === "data"
                      ? "border-[#d97706] text-[#8d4b00]"
                      : "border-transparent text-[#78716c] hover:text-[#1f1b17]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">table_rows</span>
                  <span>Data Records</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("schema")}
                  className={`py-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                    activeTab === "schema"
                      ? "border-[#d97706] text-[#8d4b00]"
                      : "border-transparent text-[#78716c] hover:text-[#1f1b17]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">schema</span>
                  <span>Table Schema</span>
                </button>
              </div>

              {/* Data Search Filter */}
              {activeTab === "data" && (
                <form onSubmit={handleDataSearch} className="flex items-center gap-1.5 my-1.5">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-2.5 top-2 text-[15px] text-[#a8a29e]">
                      search
                    </span>
                    <input
                      type="text"
                      value={searchDataQuery}
                      onChange={(e) => setSearchDataQuery(e.target.value)}
                      placeholder="Search records..."
                      className="w-48 pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[#fdf9f6] border border-[#e7e5e4] focus:outline-none focus:border-[#d97706]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 rounded-lg bg-[#f6ece6] hover:bg-[#eae1da] text-[#554336] text-xs font-semibold border border-[#e7e5e4] transition-colors cursor-pointer"
                  >
                    Filter
                  </button>
                </form>
              )}
            </div>

            {/* Tab 1: Data Records View */}
            {activeTab === "data" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-auto">
                  {loadingData ? (
                    <div className="p-12 text-center text-xs text-[#78716c] italic">
                      Loading records...
                    </div>
                  ) : !dataResponse || dataResponse.rows.length === 0 ? (
                    <div className="p-12 text-center text-xs text-[#78716c] italic">
                      No records found in '{selectedTableName}'. Click "Add Row" or "Import CSV" to populate data.
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-[#fcf8f5] border-b border-[#e7e5e4] sticky top-0 z-10">
                        <tr>
                          <th className="p-2.5 w-16 text-center text-[#78716c] font-semibold">
                            Actions
                          </th>
                          {dataResponse.columns.map((col) => (
                            <th
                              key={col}
                              onClick={() => handleSort(col)}
                              className="p-2.5 font-semibold text-[#1f1b17] font-mono cursor-pointer hover:bg-[#f6ece6] select-none whitespace-nowrap"
                            >
                              <div className="flex items-center gap-1">
                                <span>{col}</span>
                                {sortBy === col && (
                                  <span className="material-symbols-outlined text-[14px] text-[#d97706]">
                                    {sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
                                  </span>
                                )}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f0e6e0]">
                        {dataResponse.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-[#fcf8f5] transition-colors group">
                            {/* Actions Column */}
                            <td className="p-2 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditingRow(row)}
                                  className="p-1 text-[#78716c] hover:text-[#8d4b00] hover:bg-[#eae1da] rounded cursor-pointer"
                                  title="Edit row"
                                >
                                  <span className="material-symbols-outlined text-[15px]">edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRow(row)}
                                  className="p-1 text-[#78716c] hover:text-red-700 hover:bg-red-50 rounded cursor-pointer"
                                  title="Delete row"
                                >
                                  <span className="material-symbols-outlined text-[15px]">delete</span>
                                </button>
                              </div>
                            </td>
                            {dataResponse.columns.map((col) => (
                              <td
                                key={col}
                                className="p-2.5 text-[#1f1b17] max-w-xs truncate font-mono text-[11px]"
                              >
                                {row[col] !== null && row[col] !== undefined
                                  ? String(row[col])
                                  : <span className="text-[#a8a29e] italic font-sans text-xs">NULL</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Pagination Controls */}
                {dataResponse && dataResponse.total_rows > 0 && (
                  <div className="px-6 py-3 border-t border-[#e7e5e4] bg-[#fdf9f6] flex items-center justify-between text-xs text-[#554336] shrink-0">
                    <div>
                      Showing {(page - 1) * dataResponse.limit + 1} to{" "}
                      {Math.min(page * dataResponse.limit, dataResponse.total_rows)} of{" "}
                      {dataResponse.total_rows} entries
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => selectedTableName && loadTableDetails(selectedTableName, page - 1)}
                        className="px-2.5 py-1 rounded-lg border border-[#e7e5e4] bg-white hover:bg-[#f6ece6] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        Previous
                      </button>
                      <span className="px-2 font-semibold">Page {page}</span>
                      <button
                        type="button"
                        disabled={page * dataResponse.limit >= dataResponse.total_rows}
                        onClick={() => selectedTableName && loadTableDetails(selectedTableName, page + 1)}
                        className="px-2.5 py-1 rounded-lg border border-[#e7e5e4] bg-white hover:bg-[#f6ece6] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Schema View */}
            {activeTab === "schema" && (
              <div className="flex-1 overflow-auto p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#1f1b17]">Column Definitions</h3>
                  {!schema?.is_system && (
                    <button
                      type="button"
                      onClick={() => setIsAddColumnOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">add</span>
                      <span>Add Column</span>
                    </button>
                  )}
                </div>

                <div className="border border-[#e7e5e4] rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#fcf8f5] border-b border-[#e7e5e4]">
                      <tr>
                        <th className="p-3 font-semibold text-[#1f1b17]">Column Name</th>
                        <th className="p-3 font-semibold text-[#1f1b17]">Data Type</th>
                        <th className="p-3 font-semibold text-[#1f1b17]">Nullable</th>
                        <th className="p-3 font-semibold text-[#1f1b17]">Key</th>
                        <th className="p-3 font-semibold text-[#1f1b17]">Default</th>
                        <th className="p-3 font-semibold text-[#1f1b17]">Extra</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0e6e0]">
                      {schema?.columns.map((col) => (
                        <tr key={col.name} className="hover:bg-[#fcf8f5]">
                          <td className="p-3 font-mono font-semibold text-[#1f1b17]">
                            <div className="flex items-center gap-1.5">
                              {col.is_primary_key && (
                                <span className="material-symbols-outlined text-[15px] text-[#d97706]" title="Primary Key">
                                  key
                                </span>
                              )}
                              <span>{col.name}</span>
                            </div>
                          </td>
                          <td className="p-3 font-mono text-[11px] text-[#554336]">
                            {col.full_type}
                          </td>
                          <td className="p-3">
                            <span className={col.nullable ? "text-[#78716c]" : "text-amber-800 font-semibold"}>
                              {col.nullable ? "YES" : "NO (NOT NULL)"}
                            </span>
                          </td>
                          <td className="p-3">
                            {col.is_primary_key && (
                              <span className="folio-pill-badge bg-amber-50 text-amber-800 border border-amber-200">
                                PRIMARY KEY
                              </span>
                            )}
                          </td>
                          <td className="p-3 font-mono text-[11px] text-[#78716c]">
                            {col.default !== null ? String(col.default) : "NULL"}
                          </td>
                          <td className="p-3 font-mono text-[11px] text-[#78716c]">
                            {col.extra || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* MODAL 1: Create Table */}
      {isCreateTableOpen && (
        <CreateTableModal
          onClose={() => setIsCreateTableOpen(false)}
          onSuccess={(created) => {
            setIsCreateTableOpen(false);
            showToast(`Table '${created.table_name}' created`);
            loadTables();
            setSelectedTableName(created.table_name);
          }}
        />
      )}

      {/* MODAL 2: Add Column */}
      {isAddColumnOpen && selectedTableName && (
        <AddColumnModal
          tableName={selectedTableName}
          onClose={() => setIsAddColumnOpen(false)}
          onSuccess={() => {
            setIsAddColumnOpen(false);
            showToast("Column added successfully");
            loadTableDetails(selectedTableName, page);
          }}
        />
      )}

      {/* MODAL 3: Add / Insert Row */}
      {isAddRowOpen && schema && selectedTableName && (
        <AddRowModal
          tableName={selectedTableName}
          schema={schema}
          onClose={() => setIsAddRowOpen(false)}
          onSuccess={() => {
            setIsAddRowOpen(false);
            showToast("Row inserted successfully");
            loadTableDetails(selectedTableName, page);
          }}
        />
      )}

      {/* MODAL 4: Edit Row */}
      {editingRow && schema && selectedTableName && (
        <EditRowModal
          tableName={selectedTableName}
          schema={schema}
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onSuccess={() => {
            setEditingRow(null);
            showToast("Row updated successfully");
            loadTableDetails(selectedTableName, page);
          }}
        />
      )}

      {/* MODAL 5: Import CSV */}
      {isImportCsvOpen && (
        <ImportCsvModal
          currentTableName={selectedTableName}
          tables={tables}
          onClose={() => setIsImportCsvOpen(false)}
          onSuccess={(tableName) => {
            setIsImportCsvOpen(false);
            showToast("CSV imported successfully");
            loadTables();
            setSelectedTableName(tableName);
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-Modal Components
// -----------------------------------------------------------------------------

function CreateTableModal({
  onClose,
  onSuccess
}: {
  onClose: () => void;
  onSuccess: (res: any) => void;
}) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState([
    { name: "id", type: "INT", primary_key: true, auto_increment: true, nullable: false, default: "" },
    { name: "title", type: "VARCHAR(255)", primary_key: false, auto_increment: false, nullable: false, default: "" },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddColumn = () => {
    setColumns([...columns, { name: "", type: "VARCHAR(255)", primary_key: false, auto_increment: false, nullable: true, default: "" }]);
  };

  const handleRemoveColumn = (idx: number) => {
    setColumns(columns.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!tableName.trim()) {
      setError("Table name is required.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.createTable(
        tableName.trim(),
        columns.map((c) => ({
          name: c.name.trim(),
          type: c.type,
          primary_key: c.primary_key,
          auto_increment: c.auto_increment,
          nullable: c.nullable,
          default: c.default.trim() || undefined,
        }))
      );
      onSuccess(res);
    } catch (err: any) {
      setError(err.message || "Failed to create table.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl border border-[#e7e5e4] shadow-2xl max-w-lg w-full p-6 space-y-4 animate-scaleUp text-[#1f1b17]">
        <div className="flex items-center justify-between pb-3 border-b border-[#f0e6e0]">
          <h3 className="text-base font-bold text-[#1f1b17]">Create Custom Table</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-[#78716c] hover:bg-[#f6ece6] cursor-pointer">
            ✕
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#554336] mb-1">
              Table Name
            </label>
            <input
              type="text"
              required
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="e.g. experiment_runs"
              className="w-full px-3 py-2 text-xs rounded-lg border border-[#e7e5e4] focus:outline-none focus:border-[#d97706] font-mono"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-[#554336]">Columns</label>
              <button
                type="button"
                onClick={handleAddColumn}
                className="text-xs text-[#8d4b00] hover:underline flex items-center gap-1 cursor-pointer font-semibold"
              >
                + Add Column
              </button>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {columns.map((col, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-[#fcf8f5] p-2 rounded-xl border border-[#e7e5e4]">
                  <input
                    type="text"
                    required
                    placeholder="column_name"
                    value={col.name}
                    onChange={(e) => {
                      const updated = [...columns];
                      updated[idx].name = e.target.value;
                      setColumns(updated);
                    }}
                    className="flex-1 px-2.5 py-1 text-xs rounded bg-white border border-[#e7e5e4] font-mono"
                  />
                  <select
                    value={col.type}
                    onChange={(e) => {
                      const updated = [...columns];
                      updated[idx].type = e.target.value;
                      setColumns(updated);
                    }}
                    className="px-2 py-1 text-xs rounded bg-white border border-[#e7e5e4] font-mono"
                  >
                    <option value="INT">INT</option>
                    <option value="BIGINT">BIGINT</option>
                    <option value="VARCHAR(255)">VARCHAR(255)</option>
                    <option value="TEXT">TEXT</option>
                    <option value="DECIMAL(10,2)">DECIMAL(10,2)</option>
                    <option value="BOOLEAN">BOOLEAN</option>
                    <option value="DATETIME">DATETIME</option>
                  </select>
                  <label className="flex items-center gap-1 text-[11px] text-[#78716c]">
                    <input
                      type="checkbox"
                      checked={col.primary_key}
                      onChange={(e) => {
                        const updated = [...columns];
                        updated[idx].primary_key = e.target.checked;
                        if (e.target.checked) updated[idx].nullable = false;
                        setColumns(updated);
                      }}
                    />
                    PK
                  </label>
                  {columns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveColumn(idx)}
                      className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0e6e0]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[#e7e5e4] text-xs font-semibold text-[#78716c] hover:bg-[#f6ece6] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Table"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddColumnModal({
  tableName,
  onClose,
  onSuccess
}: {
  tableName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("VARCHAR(255)");
  const [nullable, setNullable] = useState(true);
  const [defaultValue, setDefaultValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.addColumn(tableName, {
        name: name.trim(),
        type,
        nullable,
        default: defaultValue.trim() || undefined,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to add column.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl border border-[#e7e5e4] shadow-2xl max-w-sm w-full p-5 space-y-4 animate-scaleUp text-[#1f1b17]">
        <div className="flex items-center justify-between pb-3 border-b border-[#f0e6e0]">
          <h3 className="text-sm font-bold">Add Column to '{tableName}'</h3>
          <button type="button" onClick={onClose} className="p-1 rounded text-[#78716c] hover:bg-[#f6ece6] cursor-pointer">
            ✕
          </button>
        </div>

        {error && <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold text-[#554336] mb-1">Column Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. status"
              className="w-full px-3 py-1.5 rounded-lg border border-[#e7e5e4] focus:outline-none focus:border-[#d97706] font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#554336] mb-1">Data Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-[#e7e5e4] font-mono"
            >
              <option value="VARCHAR(255)">VARCHAR(255)</option>
              <option value="INT">INT</option>
              <option value="TEXT">TEXT</option>
              <option value="DECIMAL(10,2)">DECIMAL(10,2)</option>
              <option value="BOOLEAN">BOOLEAN</option>
              <option value="DATETIME">DATETIME</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="col-nullable"
              checked={nullable}
              onChange={(e) => setNullable(e.target.checked)}
            />
            <label htmlFor="col-nullable" className="text-[#554336]">Allow NULL</label>
          </div>

          <div>
            <label className="block font-semibold text-[#554336] mb-1">Default Value (Optional)</label>
            <input
              type="text"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder="e.g. 'active' or 0"
              className="w-full px-3 py-1.5 rounded-lg border border-[#e7e5e4] focus:outline-none focus:border-[#d97706] font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#f0e6e0]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-[#e7e5e4] text-[#78716c] hover:bg-[#f6ece6] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] text-white font-semibold transition-colors cursor-pointer"
            >
              {loading ? "Adding..." : "Add Column"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddRowModal({
  tableName,
  schema,
  onClose,
  onSuccess
}: {
  tableName: string;
  schema: TableSchemaResponse;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.insertRow(tableName, formData);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to insert row.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl border border-[#e7e5e4] shadow-2xl max-w-md w-full p-6 space-y-4 animate-scaleUp text-[#1f1b17]">
        <div className="flex items-center justify-between pb-3 border-b border-[#f0e6e0]">
          <h3 className="text-sm font-bold">Add Row into '{tableName}'</h3>
          <button type="button" onClick={onClose} className="p-1 rounded text-[#78716c] hover:bg-[#f6ece6] cursor-pointer">
            ✕
          </button>
        </div>

        {error && <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {schema.columns
            .filter((c) => !c.extra?.includes("auto_increment"))
            .map((col) => (
              <div key={col.name}>
                <label className="block text-xs font-semibold text-[#554336] mb-1 font-mono">
                  {col.name} {!col.nullable && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  required={!col.nullable}
                  value={formData[col.name] ?? ""}
                  onChange={(e) => setFormData({ ...formData, [col.name]: e.target.value })}
                  placeholder={col.full_type}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-[#e7e5e4] focus:outline-none focus:border-[#d97706] font-mono"
                />
              </div>
            ))}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#f0e6e0]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[#e7e5e4] text-xs font-semibold text-[#78716c] hover:bg-[#f6ece6] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {loading ? "Inserting..." : "Insert Row"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditRowModal({
  tableName,
  schema,
  row,
  onClose,
  onSuccess
}: {
  tableName: string;
  schema: TableSchemaResponse;
  row: Record<string, any>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Record<string, any>>({ ...row });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const pkKeys = schema.primary_keys.length > 0 ? schema.primary_keys : ["id"];
    const pkData: Record<string, any> = {};
    for (const k of pkKeys) {
      if (row[k] !== undefined) {
        pkData[k] = row[k];
      }
    }

    try {
      await api.updateRow(tableName, pkData, formData);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to update row.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl border border-[#e7e5e4] shadow-2xl max-w-md w-full p-6 space-y-4 animate-scaleUp text-[#1f1b17]">
        <div className="flex items-center justify-between pb-3 border-b border-[#f0e6e0]">
          <h3 className="text-sm font-bold">Edit Row in '{tableName}'</h3>
          <button type="button" onClick={onClose} className="p-1 rounded text-[#78716c] hover:bg-[#f6ece6] cursor-pointer">
            ✕
          </button>
        </div>

        {error && <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {schema.columns.map((col) => {
            const isPk = col.is_primary_key;
            return (
              <div key={col.name}>
                <label className="block text-xs font-semibold text-[#554336] mb-1 font-mono">
                  {col.name} {isPk && <span className="text-[#d97706]">(Primary Key)</span>}
                </label>
                <input
                  type="text"
                  disabled={isPk}
                  value={formData[col.name] ?? ""}
                  onChange={(e) => setFormData({ ...formData, [col.name]: e.target.value })}
                  className={`w-full px-3 py-1.5 text-xs rounded-lg border border-[#e7e5e4] font-mono ${
                    isPk ? "bg-[#f6ece6] text-[#78716c] cursor-not-allowed" : "bg-white focus:border-[#d97706]"
                  }`}
                />
              </div>
            );
          })}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#f0e6e0]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[#e7e5e4] text-xs font-semibold text-[#78716c] hover:bg-[#f6ece6] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              {loading ? "Updating..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ImportCsvModal({
  currentTableName,
  tables,
  onClose,
  onSuccess
}: {
  currentTableName: string | null;
  tables: TableItem[];
  onClose: () => void;
  onSuccess: (tableName: string) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">(currentTableName ? "existing" : "new");
  const [targetTable, setTargetTable] = useState(currentTableName || (tables[0]?.table_name ?? ""));
  const [newTableName, setNewTableName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      setCsvText(content);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvText.trim()) {
      setError("Please provide CSV content or upload a CSV file.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (mode === "existing") {
        if (!targetTable) {
          setError("Target table is required.");
          setLoading(false);
          return;
        }
        await api.importCsv(targetTable, csvText);
        onSuccess(targetTable);
      } else {
        if (!newTableName.trim()) {
          setError("New table name is required.");
          setLoading(false);
          return;
        }
        const res = await api.createTableFromCsv(newTableName.trim(), csvText);
        onSuccess(res.table_name);
      }
    } catch (err: any) {
      setError(err.message || "CSV Import failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl border border-[#e7e5e4] shadow-2xl max-w-lg w-full p-6 space-y-4 animate-scaleUp text-[#1f1b17]">
        <div className="flex items-center justify-between pb-3 border-b border-[#f0e6e0]">
          <h3 className="text-base font-bold">Import CSV into MySQL</h3>
          <button type="button" onClick={onClose} className="p-1 rounded text-[#78716c] hover:bg-[#f6ece6] cursor-pointer">
            ✕
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="grid grid-cols-2 p-1 bg-[#f6ece6] rounded-xl border border-[#e7e5e4] text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode("existing")}
            className={`py-1.5 rounded-lg transition-colors cursor-pointer ${
              mode === "existing" ? "bg-white text-[#8d4b00] shadow-2xs" : "text-[#78716c]"
            }`}
          >
            Into Existing Table
          </button>
          <button
            type="button"
            onClick={() => setMode("new")}
            className={`py-1.5 rounded-lg transition-colors cursor-pointer ${
              mode === "new" ? "bg-white text-[#8d4b00] shadow-2xs" : "text-[#78716c]"
            }`}
          >
            Create New Table from CSV
          </button>
        </div>

        {error && <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-lg">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {mode === "existing" ? (
            <div>
              <label className="block font-semibold text-[#554336] mb-1">Target Table</label>
              <select
                value={targetTable}
                onChange={(e) => setTargetTable(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#e7e5e4] font-mono text-xs"
              >
                {tables.map((t) => (
                  <option key={t.table_id} value={t.table_name}>
                    {t.table_name} ({t.row_count} rows)
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block font-semibold text-[#554336] mb-1">New Table Name</label>
              <input
                type="text"
                required
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                placeholder="e.g. sales_records"
                className="w-full px-3 py-2 rounded-lg border border-[#e7e5e4] focus:outline-none focus:border-[#d97706] font-mono"
              />
            </div>
          )}

          <div>
            <label className="block font-semibold text-[#554336] mb-1">Upload CSV File</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="w-full text-xs text-[#78716c] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-[#e7e5e4] file:bg-[#f6ece6] file:text-xs file:font-semibold file:cursor-pointer hover:file:bg-[#eae1da]"
            />
          </div>

          <div>
            <label className="block font-semibold text-[#554336] mb-1">Or Paste CSV Text</label>
            <textarea
              rows={5}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="id,name,value&#10;1,Sample,100.50&#10;2,Test,250.00"
              className="w-full p-2.5 rounded-lg border border-[#e7e5e4] focus:outline-none focus:border-[#d97706] font-mono text-[11px]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#f0e6e0]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[#e7e5e4] text-[#78716c] hover:bg-[#f6ece6] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] text-white font-semibold transition-colors cursor-pointer"
            >
              {loading ? "Importing..." : "Import Data"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
