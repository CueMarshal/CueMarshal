import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, PlusCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendChatMessage, fetchChatHistory } from '../../services/api';
import { useAuthStore } from '../../stores/auth';

const WELCOME_MESSAGE = {
  id: 1,
  role: 'assistant',
  content: "Hello! I'm Marshal the Lion. How can my team help you orchestrate your pipeline today?",
  agent: 'Marshal',
};

export default function ChatView({ currentSessionId = null, onSessionChange, onNewChat }) {
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const { token } = useAuthStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load session history when currentSessionId changes
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

  const handleSend = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    // Add user message immediately
    const userMsg = { id: Date.now(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const data = await sendChatMessage(text, currentSessionId);

      // Notify parent of session ID for persistence
      if (data.sessionId && onSessionChange) {
        onSessionChange(data.sessionId);
      }

      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        content: data.message?.content || 'No response received.',
        agent: 'Marshal',
        toolCalls: data.toolCallsSummary,
      }]);
    } catch (err) {
      const status = err?.response?.status;
      let errorContent;
      if (status === 401 || status === 403) {
        errorContent = 'Your session has expired. Please log in again.';
      } else {
        errorContent = 'Sorry, I couldn\'t process that right now. Please try again.';
      }

      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        content: errorContent,
        agent: 'Marshal',
        isError: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    if (onNewChat) {
      onNewChat();
    }
  };

  const suggestions = [
    "Build a Next.js login page",
    "Review my recent PRs",
    "Deploy the staging environment",
    "Write documentation for the API"
  ];

  return (
    <div className="flex flex-col h-full w-full bg-white relative">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-full bg-cuemarshal-navy flex items-center justify-center shrink-0 overflow-hidden ring-2 ring-cuemarshal-blue ring-offset-2">
          <img src="/images/avatars/marshal.png" alt="Marshal" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-cuemarshal-navy text-lg">Marshal</h2>
          <p className="text-xs text-gray-500 font-medium">
            {isLoading ? 'Thinking...' : 'Conductor'}
            {!token && ' \u2022 Not authenticated'}
          </p>
        </div>
        <button
          onClick={handleNewChat}
          className="p-2 text-gray-400 hover:text-cuemarshal-blue transition-colors rounded-full hover:bg-gray-100"
          title="New conversation"
        >
          <PlusCircle size={20} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-4 ${
              msg.role === 'user'
                ? 'bg-cuemarshal-blue text-white rounded-br-sm'
                : msg.isError
                  ? 'bg-red-50 text-red-800 border border-red-200/60 rounded-bl-sm shadow-sm'
                  : 'bg-cuemarshal-grey text-cuemarshal-charcoal border border-gray-200/60 rounded-bl-sm shadow-sm'
            }`}>
              {msg.role === 'assistant' && (
                <div className="text-xs font-semibold mb-1 text-gray-500 uppercase tracking-wider">{msg.agent}</div>
              )}
              <div className="leading-relaxed text-[15px] whitespace-pre-wrap">{msg.content}</div>
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200/50">
                  <div className="text-[11px] text-gray-400 font-mono">
                    {msg.toolCalls.map((tc, i) => (
                      <span key={i} className="inline-block mr-2 bg-gray-100 px-1.5 py-0.5 rounded">
                        {tc.tool}: {tc.result_summary}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] md:max-w-[75%] rounded-2xl p-4 bg-cuemarshal-grey text-cuemarshal-charcoal border border-gray-200/60 rounded-bl-sm shadow-sm">
              <div className="text-xs font-semibold mb-1 text-gray-500 uppercase tracking-wider">Marshal</div>
              <div className="flex items-center gap-2 text-gray-400">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {messages.length === 1 && !isLoading && (
          <div className="flex flex-wrap gap-2 mt-4 max-w-[85%]">
            {suggestions.map((s, i) => (
              <button
                key={i}
                className="text-sm bg-gray-50 border border-gray-200 hover:border-cuemarshal-blue hover:text-cuemarshal-blue text-gray-600 px-3 py-1.5 rounded-full transition-colors"
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
      <div className="p-4 bg-white border-t border-gray-100 shrink-0">
        <form
          onSubmit={handleSend}
          className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-xl p-2 focus-within:border-cuemarshal-blue focus-within:ring-1 focus-within:ring-cuemarshal-blue transition-all"
        >
          <textarea
            className="flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-32 min-h-[44px] py-3 px-2 text-[15px] outline-none placeholder:text-gray-400"
            placeholder={token ? "Ask the team to build, review, or deploy..." : "Log in to chat with the team..."}
            rows={1}
            value={input}
            disabled={!token}
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
            className={`rounded-lg w-10 h-10 mb-0.5 ${input.trim() && !isLoading ? 'bg-cuemarshal-blue hover:bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-400 cursor-not-allowed hidden'}`}
            disabled={!input.trim() || isLoading || !token}
          >
            <Send size={18} />
          </Button>
        </form>
        <div className="text-center mt-3 text-xs text-gray-400 flex justify-center items-center gap-1">
          <Sparkles size={12} className="text-cuemarshal-blue" />
          CueMarshal automated intelligence
        </div>
      </div>
    </div>
  );
}
