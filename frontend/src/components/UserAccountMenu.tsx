import { useState, useRef } from "react";
import type { UserProfile } from "../api";

interface UserAccountMenuProps {
  user: UserProfile | null;
  onLogout: () => void;
}

export function UserAccountMenu({ user, onLogout }: UserAccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  if (!user) return null;

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    // 200ms grace period to allow cursor to smoothly move from button to dropdown menu
    timeoutRef.current = window.setTimeout(() => {
      setIsOpen(false);
    }, 220);
  };

  // Generate 2 initials from user's name
  const initials = user.name
    ? user.name
        .split(" ")
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  // Format joined date if available
  const joinedDate = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div
      className="relative inline-block text-left"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Account Button Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-2 h-9 pl-2 pr-3 rounded-full border transition-all cursor-pointer ${
          isOpen
            ? "bg-[#f6ece6] border-[#d97706]/60 shadow-xs"
            : "bg-white hover:bg-[#fcf8f5] border-[#e7e5e4] shadow-2xs"
        }`}
        title={`Account: ${user.name} (${user.email})`}
      >
        {/* Avatar Chip */}
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#8d4b00] to-[#b45309] text-white flex items-center justify-center text-[10px] font-bold tracking-tight shadow-2xs shrink-0">
          {initials}
        </div>

        {/* User Name & Chevron */}
        <span className="text-xs font-semibold text-[#1f1b17] max-w-[110px] truncate hidden sm:inline">
          {user.name}
        </span>
        <span className="material-symbols-outlined text-[15px] text-[#78716c]">
          expand_more
        </span>
      </button>

      {/* Hover Dropdown User Info Card */}
      {isOpen && (
        <div
          className="absolute right-0 top-full pt-1.5 z-50 w-64 animate-fadeIn"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="bg-white rounded-2xl border border-[#e7e5e4] shadow-xl p-4 text-[#1f1b17]">
            {/* Header: Large Avatar & Identity */}
            <div className="flex items-center gap-3 pb-3 border-b border-[#f0e6e0]">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#8d4b00] to-[#b45309] text-white flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-[#1f1b17] truncate leading-tight">
                  {user.name}
                </div>
                <div className="text-xs text-[#78716c] truncate mt-0.5">
                  {user.email}
                </div>
              </div>
            </div>

            {/* Profile Meta Details */}
            <div className="py-2.5 space-y-1.5 text-xs text-[#554336]">
              <div className="flex items-center justify-between">
                <span className="text-[#78716c]">Account ID</span>
                <span className="font-mono text-[11px] font-medium bg-[#f6ece6] px-1.5 py-0.5 rounded text-[#8d4b00]">
                  #{user.user_id}
                </span>
              </div>
              {joinedDate && (
                <div className="flex items-center justify-between">
                  <span className="text-[#78716c]">Member Since</span>
                  <span className="font-medium text-[#1f1b17]">{joinedDate}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[#78716c]">Status</span>
                <span className="flex items-center gap-1 text-emerald-700 font-medium text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Active
                </span>
              </div>
            </div>

            {/* Logout Action */}
            <div className="pt-2 border-t border-[#f0e6e0]">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[17px]">logout</span>
                <span>Log Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
