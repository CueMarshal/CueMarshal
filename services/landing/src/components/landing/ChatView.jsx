import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ChatView() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'assistant',
      content: "Hello! I'm Marshal the Lion. How can my team help you orchestrate your pipeline today?",
      agent: 'Marshal',
    }
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Add user message
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: input }]);

    // Simulate thinking/response
    const userMsg = input;
    setInput('');

    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        content: `Got it. I'll get Ava to architect a plan, and Dave will start building the components for "\${userMsg}".`,
        agent: 'Marshal'
      }]);
    }, 1000);
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
          <img src="/avatars/marshal.png" alt="Marshal" className="w-full h-full object-cover" />
        </div>
        <div>
          <h2 className="font-semibold text-cuemarshal-navy text-lg">Marshal</h2>
          <p className="text-xs text-gray-500 font-medium">Conductor • Ready</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex \${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-4 \${
              msg.role === 'user' 
                ? 'bg-cuemarshal-blue text-white rounded-br-sm' 
                : 'bg-cuemarshal-grey text-cuemarshal-charcoal border border-gray-200/60 rounded-bl-sm shadow-sm'
            }`}>
              {msg.role === 'assistant' && (
                <div className="text-xs font-semibold mb-1 text-gray-500 uppercase tracking-wider">{msg.agent}</div>
              )}
              <div className="leading-relaxed text-[15px] whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
        {messages.length === 1 && (
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
          <button type="button" className="p-2 text-gray-400 hover:text-cuemarshal-blue transition-colors rounded-full hover:bg-gray-100 mb-1">
            <PlusCircle size={20} />
          </button>
          <textarea
            className="flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-32 min-h-[44px] py-3 px-2 text-[15px] outline-none placeholder:text-gray-400"
            placeholder="Ask the team to build, review, or deploy..."
            rows={1}
            value={input}
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
            className={`rounded-lg w-10 h-10 mb-0.5 \${input.trim() ? 'bg-cuemarshal-blue hover:bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-400 cursor-not-allowed hidden'}`}
            disabled={!input.trim()}
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
