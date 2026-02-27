import React, { useState } from 'react';
import { MessageSquare, Plus, Search, Trash2, Star, X, Loader2 } from 'lucide-react';

function formatRelativeTime(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDisplayTitle(session) {
  if (session.title) return session.title;
  if (session.preview) return session.preview.substring(0, 50) || 'Untitled Chat';
  return 'Untitled Chat';
}

export default function SessionSidebar({
  sessions = [],
  currentSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onToggleFavorite,
  isOpen,
  onClose,
  isLoading,
  isMobileOverlay = false,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const filtered = sessions.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const title = getDisplayTitle(s).toLowerCase();
    const preview = (s.preview || '').toLowerCase();
    return title.includes(q) || preview.includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.is_favorite && !b.is_favorite) return -1;
    if (!a.is_favorite && b.is_favorite) return 1;
    return new Date(b.updated_at) - new Date(a.updated_at);
  });

  const handleDelete = (e, sessionId) => {
    e.stopPropagation();
    if (confirmDeleteId === sessionId) {
      onDeleteSession(sessionId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(sessionId);
      setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  };

  const handleFavorite = (e, sessionId, isFavorite) => {
    e.stopPropagation();
    onToggleFavorite(sessionId, isFavorite);
  };

  if (isMobileOverlay) {
    if (!isOpen) return null;
    return (
      <div className="fixed inset-0 z-50 md:hidden">
        <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
        <div className="absolute left-0 top-0 bottom-0 w-[min(280px,85vw)] bg-white flex flex-col shadow-2xl animate-slide-in-left">
          {renderContent(true)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white w-full">
      {renderContent(false)}
    </div>
  );

  function renderContent(showCloseButton) {
    return (
      <>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-cuemarshal-navy text-sm uppercase tracking-wider">Chat History</h3>
          {showCloseButton && (
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* New Chat Button */}
        <div className="px-3 py-2 shrink-0">
          <button
            onClick={onNewChat}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-cuemarshal-blue text-white text-sm font-medium hover:bg-blue-600 active:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus size={16} />
            New Chat
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-cuemarshal-blue focus:ring-1 focus:ring-cuemarshal-blue transition-all placeholder:text-gray-400"
            />
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto hide-scrollbar">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <MessageSquare size={28} className="mx-auto text-gray-300 mb-2" />
              <p className="text-xs text-gray-400">
                {searchQuery ? 'No matching conversations' : 'No conversations yet.'}
              </p>
              {!searchQuery && (
                <p className="text-xs text-gray-400 mt-1">Start a new chat!</p>
              )}
            </div>
          ) : (
            <div className="py-1">
              {sorted.map((session) => {
                const isActive = session.id === currentSessionId;
                const isConfirmingDelete = confirmDeleteId === session.id;
                return (
                  <div
                    key={session.id}
                    onClick={() => onSelectSession(session.id)}
                    className={`group relative px-3 py-2.5 mx-2 mb-0.5 rounded-lg cursor-pointer transition-all ${
                      isActive
                        ? 'bg-cuemarshal-blue/10 border-l-2 border-cuemarshal-blue'
                        : 'hover:bg-gray-50 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isActive ? 'text-cuemarshal-navy' : 'text-gray-700'}`}>
                          {getDisplayTitle(session)}
                        </p>
                        {session.preview && (
                          <p className="text-xs text-gray-400 truncate mt-0.5">{session.preview}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                          <span>{session.message_count || 0} messages</span>
                          <span>&middot;</span>
                          <span>{formatRelativeTime(session.updated_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleFavorite(e, session.id, session.is_favorite)}
                          className="p-1.5 rounded-md hover:bg-gray-200 transition-colors"
                          title={session.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star
                            size={14}
                            className={session.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-gray-400'}
                          />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, session.id)}
                          className={`p-1.5 rounded-md transition-colors ${
                            isConfirmingDelete
                              ? 'bg-red-100 text-red-600'
                              : 'hover:bg-red-50 text-gray-400 hover:text-red-500'
                          }`}
                          title={isConfirmingDelete ? 'Click again to confirm' : 'Delete conversation'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {session.is_favorite && (
                      <Star
                        size={11}
                        className="fill-yellow-400 text-yellow-400 absolute top-2.5 right-2.5 group-hover:hidden pointer-events-none"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-100 text-center shrink-0">
          <div className="text-[11px] text-gray-400 font-medium">
            Powered by CueMarshal
          </div>
        </div>
      </>
    );
  }
}
