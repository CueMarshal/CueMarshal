import React, { useState, useEffect, useCallback } from 'react';
import {
  Kanban,
  AlertCircle,
  Loader2,
  RefreshCw,
  ExternalLink,
  GitPullRequest,
  CircleDot,
  CheckCircle2,
  Clock,
  ChevronDown,
  Tag,
  User as UserIcon,
} from 'lucide-react';
import { fetchProjectBoard, fetchProjectRepos } from '../../services/api';

const COLUMN_CONFIG = {
  backlog: { title: 'Backlog', icon: Clock, color: 'border-gray-300', bg: 'bg-gray-50', badge: 'bg-gray-200 text-gray-600' },
  in_progress: { title: 'In Progress', icon: CircleDot, color: 'border-blue-400', bg: 'bg-blue-50/50', badge: 'bg-blue-100 text-blue-700' },
  in_review: { title: 'Review', icon: GitPullRequest, color: 'border-amber-400', bg: 'bg-amber-50/50', badge: 'bg-amber-100 text-amber-700' },
  done: { title: 'Done', icon: CheckCircle2, color: 'border-green-400', bg: 'bg-green-50/50', badge: 'bg-green-100 text-green-700' },
};

const POLL_INTERVAL = 60_000;

function formatTimeAgo(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function BoardCard({ item }) {
  const isPR = item.type === 'pull_request';
  const isMerged = item.state === 'merged';
  const isClosed = item.state === 'closed';

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white rounded-lg border border-gray-200 p-3 hover:shadow-md hover:border-gray-300 transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 font-mono shrink-0">
          {isPR ? (
            <GitPullRequest size={13} className={isMerged ? 'text-purple-500' : isClosed ? 'text-red-400' : 'text-green-500'} />
          ) : (
            <CircleDot size={13} className={isClosed ? 'text-purple-500' : 'text-green-500'} />
          )}
          #{item.number}
        </div>
        <ExternalLink size={12} className="text-gray-300 group-hover:text-gray-500 transition-colors shrink-0 mt-0.5" />
      </div>

      <p className="text-sm font-medium text-gray-800 leading-snug mb-2 line-clamp-2">
        {item.title}
      </p>

      {item.labels && item.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {item.labels.slice(0, 3).map((label, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border"
              style={{
                backgroundColor: `#${label.color}20`,
                borderColor: `#${label.color}40`,
                color: `#${label.color}`,
              }}
            >
              <Tag size={8} />
              {label.name}
            </span>
          ))}
          {item.labels.length > 3 && (
            <span className="text-[10px] text-gray-400">+{item.labels.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex -space-x-1.5">
          {(item.assignees || []).slice(0, 3).map((a, i) => (
            a.avatar_url ? (
              <img
                key={i}
                src={a.avatar_url}
                alt={a.username}
                title={a.username}
                className="w-5 h-5 rounded-full border border-white"
              />
            ) : (
              <div key={i} className="w-5 h-5 rounded-full bg-gray-200 border border-white flex items-center justify-center" title={a.username}>
                <UserIcon size={10} className="text-gray-500" />
              </div>
            )
          ))}
        </div>
        <span className="text-[10px] text-gray-400">{formatTimeAgo(item.updated_at)}</span>
      </div>

      {isPR && item.head && (
        <div className="mt-2 text-[10px] text-gray-400 font-mono truncate">
          {item.head} → {item.base}
        </div>
      )}
    </a>
  );
}

function BoardColumn({ columnKey, items }) {
  const cfg = COLUMN_CONFIG[columnKey];
  const Icon = cfg.icon;
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`flex flex-col min-w-[260px] max-w-[320px] flex-1 rounded-xl border-t-2 ${cfg.color} ${cfg.bg}`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between px-3 py-2.5 text-left shrink-0"
      >
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-700">{cfg.title}</h3>
          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
            {items.length}
          </span>
        </div>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 hide-scrollbar">
          {items.length === 0 ? (
            <div className="text-center py-6 text-xs text-gray-400">No items</div>
          ) : (
            items.map((item) => (
              <BoardCard key={`${item.type}-${item.number}`} item={item} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ProjectBoard() {
  const [board, setBoard] = useState(null);
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showRepoPicker, setShowRepoPicker] = useState(false);

  const loadBoard = useCallback(async (repo) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchProjectBoard(repo);
      setBoard(data);
    } catch (err) {
      setError('Failed to load project board');
      console.error('Board load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadRepos = useCallback(async () => {
    try {
      const data = await fetchProjectRepos();
      setRepos(data.repos || []);
    } catch {
      // Non-critical — repo picker won't show
    }
  }, []);

  useEffect(() => {
    loadBoard(selectedRepo);
    loadRepos();
    const interval = setInterval(() => loadBoard(selectedRepo), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [selectedRepo, loadBoard, loadRepos]);

  return (
    <div className="flex flex-col h-full w-full bg-cuemarshal-grey text-cuemarshal-charcoal overflow-hidden p-4 lg:p-6">
      {/* Header */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div>
          <h2 className="font-montserrat font-bold text-xl text-cuemarshal-navy flex items-center gap-2">
            <Kanban className="text-cuemarshal-blue" size={22} />
            Project Board
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {board?.repo || 'Loading...'}
            {board?.summary && (
              <span className="ml-2">
                &middot; {board.summary.open_issues} open issues &middot; {board.summary.open_prs} open PRs
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Repo picker */}
          <div className="relative">
            <button
              onClick={() => setShowRepoPicker(!showRepoPicker)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-cuemarshal-navy bg-white border border-gray-200 rounded-lg px-3 py-1.5 transition-colors"
            >
              {board?.repo?.split('/')[1] || 'Select repo'}
              <ChevronDown size={12} />
            </button>
            {showRepoPicker && repos.length > 0 && (
              <>
                <div className="fixed inset-0 z-10" role="presentation" onClick={() => setShowRepoPicker(false)} />
                <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 max-h-60 overflow-y-auto">
                  {repos.map((r) => (
                    <button
                      key={r.full_name}
                      onClick={() => {
                        setSelectedRepo(r.full_name);
                        setShowRepoPicker(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${selectedRepo === r.full_name ? 'bg-blue-50 text-cuemarshal-blue font-medium' : 'text-gray-700'}`}
                    >
                      <div className="font-medium truncate">{r.name}</div>
                      {r.description && (
                        <div className="text-[11px] text-gray-400 truncate">{r.description}</div>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => loadBoard(selectedRepo)}
            disabled={isLoading}
            className="p-1.5 text-gray-400 hover:text-cuemarshal-blue rounded-lg hover:bg-white border border-transparent hover:border-gray-200 transition-all disabled:opacity-50"
            title="Refresh board"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 shrink-0">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Board Columns */}
      {isLoading && !board ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-gray-400">
            <Loader2 className="animate-spin" size={24} />
            <span className="text-sm font-medium">Loading board...</span>
          </div>
        </div>
      ) : board ? (
        <div className="flex-1 overflow-x-auto overflow-y-hidden pb-2">
          <div className="flex gap-3 h-full min-w-max">
            {Object.keys(COLUMN_CONFIG).map((key) => (
              <BoardColumn
                key={key}
                columnKey={key}
                items={board.columns[key] || []}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
