import React, { useState } from "react";
import { api, type UserProfile } from "../api";

interface AuthScreenProps {
  onAuthSuccess: (user: UserProfile) => void;
}

export function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const res = await api.login(email.trim(), password);
        onAuthSuccess(res.user);
      } else {
        if (!name.trim()) {
          setError("Please enter your name");
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError("Password must be at least 6 characters");
          setLoading(false);
          return;
        }
        const res = await api.signup(name.trim(), email.trim(), password);
        onAuthSuccess(res.user);
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (demoEmail: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(demoEmail, "password123");
      onAuthSuccess(res.user);
    } catch (err: any) {
      setError(`Failed to sign in as ${demoEmail}: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-center items-center bg-[#fdf9f6] text-[#1f1b17] px-4 py-12 relative overflow-hidden font-sans">
      {/* Decorative Warm Background Ambiance */}
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-[#fbe3d5]/40 to-transparent blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-[#f3e6dd]/40 to-transparent blur-3xl pointer-events-none" />

      {/* Main Authentication Card */}
      <div className="w-full max-w-[420px] bg-white rounded-2xl border border-[#e7e5e4] shadow-xl p-8 relative z-10 animate-fadeIn">
        {/* Folio Brandmark & Heading */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-[#8d4b00] to-[#b45309] text-white flex items-center justify-center shadow-md mb-3">
            <span className="material-symbols-outlined text-[26px]">menu_book</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1f1b17] font-serif-editorial">
            Folio
          </h1>
          <p className="text-xs text-[#78716c] mt-1">
            Connected Personal Knowledge Base
          </p>
        </div>

        {/* Tab Toggle: Sign In / Create Account */}
        <div className="grid grid-cols-2 p-1 bg-[#f6ece6] rounded-xl border border-[#e7e5e4]/80 text-xs font-semibold mb-6">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={`py-2 rounded-lg transition-all cursor-pointer ${
              mode === "login"
                ? "bg-white text-[#8d4b00] shadow-2xs"
                : "text-[#78716c] hover:text-[#1f1b17]"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setError(null);
            }}
            className={`py-2 rounded-lg transition-all cursor-pointer ${
              mode === "signup"
                ? "bg-white text-[#8d4b00] shadow-2xs"
                : "text-[#78716c] hover:text-[#1f1b17]"
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2 animate-fadeIn">
            <span className="material-symbols-outlined text-[16px] shrink-0 text-red-500">error</span>
            <span className="flex-1">{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="block text-xs font-semibold text-[#554336] mb-1.5">
                Full Name
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-[#a8a29e]">
                  person
                </span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Eleanor Vance"
                  className="w-full pl-9 pr-3.5 py-2 text-sm rounded-lg bg-[#fdf9f6] border border-[#e7e5e4] focus:outline-none focus:border-[#d97706] focus:bg-white text-[#1f1b17] transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#554336] mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-[#a8a29e]">
                mail
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-9 pr-3.5 py-2 text-sm rounded-lg bg-[#fdf9f6] border border-[#e7e5e4] focus:outline-none focus:border-[#d97706] focus:bg-white text-[#1f1b17] transition-colors"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-[#554336]">
                Password
              </label>
              {mode === "signup" && (
                <span className="text-[11px] text-[#78716c]">Min. 6 chars</span>
              )}
            </div>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-[#a8a29e]">
                lock
              </span>
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-10 py-2 text-sm rounded-lg bg-[#fdf9f6] border border-[#e7e5e4] focus:outline-none focus:border-[#d97706] focus:bg-white text-[#1f1b17] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-[#a8a29e] hover:text-[#554336] cursor-pointer"
                title={showPassword ? "Hide password" : "Show password"}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {showPassword ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 mt-2 rounded-lg bg-[#8d4b00] hover:bg-[#723c00] active:scale-[0.99] text-white text-sm font-semibold shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span>{mode === "login" ? "Sign In" : "Create Account"}</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </>
            )}
          </button>
        </form>

        {/* Demo Accounts Quick Selection */}
        <div className="mt-6 pt-5 border-t border-[#f0e6e0]">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#78716c] text-center mb-3">
            Quick Demo Accounts
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickLogin("alice@example.com")}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[#e7e5e4] bg-[#fcf8f5] hover:bg-[#f6ece6] transition-colors text-xs text-left cursor-pointer group"
            >
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#8d4b00]/15 text-[#8d4b00] font-bold text-[10px] flex items-center justify-center">
                  AC
                </span>
                <div>
                  <span className="font-semibold text-[#1f1b17] block">Alice Chen</span>
                  <span className="text-[11px] text-[#78716c]">alice@example.com</span>
                </div>
              </div>
              <span className="text-[11px] text-[#8d4b00] font-medium group-hover:underline flex items-center gap-0.5">
                Sign In
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              </span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickLogin("bob@example.com")}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[#e7e5e4] bg-[#fcf8f5] hover:bg-[#f6ece6] transition-colors text-xs text-left cursor-pointer group"
            >
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-700/15 text-emerald-800 font-bold text-[10px] flex items-center justify-center">
                  BM
                </span>
                <div>
                  <span className="font-semibold text-[#1f1b17] block">Bob Martinez</span>
                  <span className="text-[11px] text-[#78716c]">bob@example.com</span>
                </div>
              </div>
              <span className="text-[11px] text-[#8d4b00] font-medium group-hover:underline flex items-center gap-0.5">
                Sign In
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              </span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickLogin("charlie@example.com")}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[#e7e5e4] bg-[#fcf8f5] hover:bg-[#f6ece6] transition-colors text-xs text-left cursor-pointer group"
            >
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-sky-700/15 text-sky-800 font-bold text-[10px] flex items-center justify-center">
                  CK
                </span>
                <div>
                  <span className="font-semibold text-[#1f1b17] block">Charlie Kim</span>
                  <span className="text-[11px] text-[#78716c]">charlie@example.com</span>
                </div>
              </div>
              <span className="text-[11px] text-[#8d4b00] font-medium group-hover:underline flex items-center gap-0.5">
                Sign In
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Footer copyright / subtle detail */}
      <div className="mt-6 text-xs text-[#a8a29e] text-center">
        Folio • MySQL Relational Knowledge System
      </div>
    </div>
  );
}
