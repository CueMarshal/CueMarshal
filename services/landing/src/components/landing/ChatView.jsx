import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, PlusCircle, Loader2, GitCommit, FileText, Terminal, Search, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendChatMessage, streamChatMessage, fetchChatHistory, fetchProjectBoard } from '../../services/api';
import { useAuthStore } from '../../stores/auth';

const WELCOME_MESSAGE = {
  id: 1,
  role: 'assistant',
  content: "Hello! I'm Marshal the Lion. How can my team help you today?",
  agent: 'Marshal',
};

const getToolDisplay = (toolName) => {
  if (toolName.includes('git')) return { icon: GitCommit, label: 'Source Control' };
  if (toolName.includes('file') || toolName.includes('read') || toolName.includes('write')) return { icon: FileText, label: 'File System' };
  if (toolName.includes('search')) return { icon: Search, label: 'Code Search' };
  return { icon: Terminal, label: 'System Action' };
};

export default function ChatView({ currentSessionId = null, onSessionChange, onNewChat }) {
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);
  const { token } = useAuthStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!currentSessionId) {
      setMessages([{ ...WELCOME_MESSAGE, id: Date.now() }]);
      return;
    }

    const loadHistory = async () => {
      try {
        setIsLoading(true);
        const data = await fetchChatHistory(currentSessionId);
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages.map((msg, i) => ({
            id: i + 1,
            role: msg.role,
            content: msg.content,
            agent: msg.role === 'assistant' ? 'Marshal' : undefined,
            toolCalls: msg.tool_calls || undefined,
          })));
        } else {
          setMessages([{ ...WELCOME_MESSAGE, id: Date.now() }]);
        }
      } catch (err) {
        console.error('Failed to load session history:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadHistory();
  }, [currentSessionId]);

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
    setIsLoading(false);
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.isStreaming) {
        return [...prev.slice(0, -1), { ...last, isStreaming: false }];
      }
      return prev;
    });
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg = { id: Date.now(), role: 'user', content: text };
    const streamingMsgId = Date.now() + 1;
    setMessages(prev => [...prev, userMsg, {
      id: streamingMsgId,
      role: 'assistant',
      content: '',
      agent: 'Marshal',
      isStreaming: true,
      toolCalls: [],
    }]);
    setInput('');
    setIsLoading(true);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChatMessage(text, currentSessionId, {
        onChunk: (chunk) => {
          if (controller.signal.aborted) return;

          if (chunk.type === 'session_id' && chunk.session_id && onSessionChange) {
            onSessionChange(chunk.session_id);
          } else if (chunk.type === 'text') {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.id !== streamingMsgId) return prev;
              return [...prev.slice(0, -1), {
                ...last,
                content: last.content + (chunk.delta || ''),
              }];
            });
          } else if (chunk.type === 'tool_call') {
            setMessages(prev => {
              const last = prev[prev.length - 1];
              if (last?.id !== streamingMsgId) return prev;
              return [...prev.slice(0, -1), {
                ...last,
                toolCalls: [...(last.toolCalls || []), { tool: chunk.tool, result_summary: chunk.result_summary }],
              }];
            });
          }
        },
        onDone: () => {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.id !== streamingMsgId) return prev;
            return [...prev.slice(0, -1), { ...last, isStreaming: false }];
          });
        },
        onError: (err) => {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.id !== streamingMsgId) return prev;
            return [...prev.slice(0, -1), {
              ...last,
              content: last.content || 'Sorry, I couldn\'t process that right now. Please try again.',
              isStreaming: false,
              isError: !last.content,
            }];
          });
        },
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const status = err?.response?.status || err?.status;
      let errorContent;
      if (status === 401 || status === 403) {
        errorContent = 'Your session has expired. Please log in again.';
      } else {
        errorContent = 'Sorry, I couldn\'t process that right now. Please try again.';
      }

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.id === streamingMsgId && !last.content) {
          return [...prev.slice(0, -1), {
            ...last,
            content: errorContent,
            isStreaming: false,
            isError: true,
          }];
        }
        return [...prev, {
          id: Date.now(),
          role: 'assistant',
          content: errorContent,
          agent: 'Marshal',
          isError: true,
        }];
      });
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleNewChat = () => {
    if (isStreaming) handleStop();
    if (onNewChat) {
      onNewChat();
    }
  };

  const [suggestions, setSuggestions] = useState([
    "Build a Next.js login page",
    "Review my recent PRs",
    "Deploy the staging environment",
    "Write documentation for the API",
  ]);

  useEffect(() => {
    if (!token) return;
    fetchProjectBoard()
      .then((board) => {
        const dynamic = [];
        const openPRs = board?.columns?.in_review || [];
        if (openPRs.length > 0) {
          dynamic.push(`Review PR #${openPRs[0].number}: ${openPRs[0].title.substring(0, 40)}`);
        }
        const backlog = board?.columns?.backlog || [];
        if (backlog.length > 0) {
          dynamic.push(`Work on issue #${backlog[0].number}: ${backlog[0].title.substring(0, 40)}`);
        }
        const inProgress = board?.columns?.in_progress || [];
        if (inProgress.length > 0) {
          dynamic.push(`Check status of #${inProgress[0].number}`);
        }
        if (dynamic.length > 0) {
          setSuggestions(prev => [...dynamic, ...prev.slice(0, 4 - dynamic.length)]);
        }
      })
      .catch(() => {});
  }, [token]);

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-dark-bg relative">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 dark:border-dark-border flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-cuemarshal-navy flex items-center justify-center shrink-0 overflow-hidden ring-2 ring-cuemarshal-blue ring-offset-2">
          <img src="/images/avatars/marshal.png" alt="Marshal" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-cuemarshal-navy dark:text-white text-base sm:text-lg">Marshal</h2>
          <p className="text-xs text-gray-500 font-medium truncate">
            {isLoading ? 'Thinking...' : 'Conductor'}
            {!token && ' \u2022 Not authenticated'}
          </p>
        </div>
        <button
          onClick={handleNewChat}
          className="p-2 text-gray-400 hover:text-cuemarshal-blue transition-colors rounded-full hover:bg-gray-100"
          title="New conversation"
          aria-label="New conversation"
        >
          <PlusCircle size={20} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] sm:max-w-[80%] lg:max-w-[75%] rounded-2xl px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-cuemarshal-blue text-white rounded-br-sm'
                : msg.isError
                  ? 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200/60 dark:border-red-800/40 rounded-bl-sm shadow-sm'
                  : 'bg-cuemarshal-grey dark:bg-dark-card text-cuemarshal-charcoal dark:text-dark-text border border-gray-200/60 dark:border-dark-border rounded-bl-sm shadow-sm'
            }`}>
              {msg.role === 'assistant' && (
                <div className="text-[11px] font-semibold mb-1 text-gray-500 uppercase tracking-wider">{msg.agent}</div>
              )}
              <div className="leading-relaxed text-sm whitespace-pre-wrap">
                {msg.content}
                {msg.isStreaming && <span className="inline-block w-1.5 h-4 ml-0.5 bg-cuemarshal-blue/70 animate-pulse align-text-bottom rounded-sm" />}
              </div>
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    <Sparkles size={10} />
                    <span>Actions Taken</span>
                  </div>
                  {msg.toolCalls.map((tc, i) => {
                    const { icon: Icon, label } = getToolDisplay(tc.tool);
                    return (
                      <div key={i} className="flex items-start gap-2 text-xs bg-white/60 p-2 rounded-lg border border-gray-100/60">
                        <div className="p-1 bg-gray-100 rounded shrink-0 text-gray-500">
                          <Icon size={12} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-700 text-xs">{label}</div>
                          {tc.result_summary && (
                            <div className="text-gray-500 text-[11px] leading-relaxed break-words mt-0.5">{tc.result_summary}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && !isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-[88%] sm:max-w-[80%] lg:max-w-[75%] rounded-2xl px-4 py-3 bg-cuemarshal-grey text-cuemarshal-charcoal border border-gray-200/60 rounded-bl-sm shadow-sm">
              <div className="text-[11px] font-semibold mb-1 text-gray-500 uppercase tracking-wider">Marshal</div>
              <div className="flex items-center gap-2 text-gray-400">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {messages.length === 1 && !isLoading && (
          <div className="flex flex-wrap gap-2 mt-2 sm:mt-4 max-w-[88%] sm:max-w-[80%]">
            {suggestions.map((s, i) => (
              <button
                key={i}
                className="text-sm bg-gray-50 border border-gray-200 hover:border-cuemarshal-blue hover:text-cuemarshal-blue text-gray-600 px-3 py-1.5 rounded-full transition-colors active:bg-gray-100"
                onClick={() => setInput(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 sm:p-4 bg-white dark:bg-dark-bg border-t border-gray-100 dark:border-dark-border shrink-0">
        {isStreaming && (
          <div className="flex justify-center mb-2">
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-red-500 bg-gray-100 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-full transition-colors"
            >
              <StopCircle size={14} />
              Stop generating
            </button>
          </div>
        )}
        <form
          onSubmit={handleSend}
          className="flex items-end gap-2 bg-gray-50 dark:bg-dark-surface border border-gray-200 dark:border-dark-border rounded-xl p-1.5 sm:p-2 focus-within:border-cuemarshal-blue focus-within:ring-1 focus-within:ring-cuemarshal-blue transition-all"
        >
          <textarea
            className="flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-32 min-h-[44px] py-2.5 sm:py-3 px-2 text-sm outline-none placeholder:text-gray-400"
            placeholder={token ? "Ask the team to build, review, or deploy..." : "Log in to chat with the team..."}
            rows={1}
            value={input}
            disabled={!token || isStreaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            className={`rounded-lg w-9 h-9 sm:w-10 sm:h-10 mb-0.5 shrink-0 transition-colors ${
              input.trim() && !isLoading && token
                ? 'bg-cuemarshal-blue hover:bg-blue-600 text-white shadow-sm'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
            disabled={!input.trim() || isLoading || !token}
          >
            <Send size={16} />
          </Button>
        </form>
        <div className="text-center mt-2 sm:mt-3 text-[11px] sm:text-xs text-gray-400 flex justify-center items-center gap-1">
          <Sparkles size={11} className="text-cuemarshal-blue" />
          CueMarshal automated intelligence
        </div>
      </div>
    </div>
  );
}
