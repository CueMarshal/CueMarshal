import React, { useState, useEffect } from 'react';
import { Bot, Terminal, LogOut, User as UserIcon, Sparkles, Menu } from 'lucide-react';
import ChatView from './ChatView';
import ActivityView from './ActivityView';
import SessionSidebar from './SessionSidebar';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '../../stores/auth';
import { fetchChatSessions, deleteChatSession, updateChatSession } from '../../services/api';
import { storage } from '../../services/storage';

export default function WebLanding() {
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'activity' on mobile
  const { token, user, logout, startOAuthFlow } = useAuthStore();

  // Session management state
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const handleLogin = async () => {
    const result = await startOAuthFlow();
    if (!result.success && result.error) {
      alert(`Login failed: ${result.error}`);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  // Load sessions and restore active session on auth
  useEffect(() => {
    if (token && user) {
      loadSessions();
      restoreSession();
    }
  }, [token, user]);

  const loadSessions = async () => {
    try {
      setSessionsLoading(true);
      const data = await fetchChatSessions();
      setSessions(data.sessions || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setSessionsLoading(false);
    }
  };

  const restoreSession = async () => {
    const savedId = await storage.getCurrentSessionId();
    if (savedId) {
      setCurrentSessionId(savedId);
    }
  };

  const handleSessionChange = async (sessionId) => {
    setCurrentSessionId(sessionId);
    await storage.saveCurrentSessionId(sessionId);
    // Refresh sessions list to update previews
    loadSessions();
  };

  const handleSelectSession = (sessionId) => {
    setCurrentSessionId(sessionId);
    storage.saveCurrentSessionId(sessionId);
    setSidebarOpen(false);
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    storage.clearCurrentSessionId();
    setSidebarOpen(false);
  };

  const handleDeleteSession = async (sessionId) => {
    try {
      await deleteChatSession(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        await storage.clearCurrentSessionId();
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleToggleFavorite = async (sessionId, isFavorite) => {
    try {
      await updateChatSession(sessionId, { is_favorite: !isFavorite });
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, is_favorite: !isFavorite } : s
      ));
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  // Show login screen if not authenticated
  if (!token || !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cuemarshal-navy via-cuemarshal-blue to-blue-600 text-white font-inter flex flex-col">
        <header className="flex items-center justify-between p-4 md:p-6">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="CueMarshal" className="h-10 w-auto" />
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full text-center">
            <div className="mb-8 flex justify-center">
              <div className="relative">
                <img src="/icon.svg" alt="CueMarshal Icon" className="h-32 w-32 animate-pulse" />
                <div className="absolute -inset-4 bg-white/10 rounded-full blur-2xl"></div>
              </div>
            </div>
            
            <h1 className="font-montserrat font-bold text-4xl md:text-6xl mb-4">
              Welcome to <span className="text-cuemarshal-blue">CueMarshal</span>
            </h1>
            <p className="text-xl md:text-2xl text-blue-100 mb-8 font-light">
              Your AI-powered development orchestra
            </p>
            <p className="text-lg text-blue-200 mb-12 max-w-xl mx-auto">
              Marshal and the team are ready to help you build, review, and deploy with precision and harmony.
            </p>
            
            <Button
              onClick={handleLogin}
              size="lg"
              className="bg-white text-cuemarshal-navy hover:bg-blue-50 font-bold text-lg px-8 py-6 rounded-xl shadow-2xl transition-all hover:scale-105"
            >
              <Sparkles className="mr-2" size={24} />
              Login to Platform
            </Button>

            <div className="mt-16 grid grid-cols-3 md:grid-cols-7 gap-4 opacity-60">
              {['marshal.png', 'ava.png', 'dave.png', 'reese.png', 'tess.png', 'devin.png', 'dot.png', 'linton.png'].map((avatar, i) => (
                <div key={i} className="flex flex-col items-center">
                  <img src={`/images/avatars/${avatar}`} alt="Agent" className="w-16 h-16 rounded-full border-2 border-white/30" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="p-6 text-center text-blue-200 text-sm">
          <p>© 2026 CueMarshal. AI-powered development automation.</p>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cuemarshal-white text-cuemarshal-charcoal font-inter flex flex-col overflow-hidden">
      {/* Navbar Minimal */}
      <header className="flex items-center justify-between p-4 border-b border-gray-100 bg-cuemarshal-navy text-white">
        <div className="flex items-center gap-3">
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 text-gray-300 hover:text-white rounded transition-colors"
          >
            <Menu size={20} />
          </button>
          <img src="/logo.svg" alt="CueMarshal" className="h-8 w-auto" />
        </div>
        <div className="flex items-center gap-4">
          <Button variant="ghost" className="text-gray-300 hover:text-white font-medium hidden md:flex" asChild>
            <a href="/gitea/">Source Repositories</a>
          </Button>
          {token && user ? (
            <>
              <div className="hidden md:flex items-center gap-2 text-gray-300">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.username} className="w-8 h-8 rounded-full" />
                ) : (
                  <UserIcon size={20} />
                )}
                <span className="text-sm">{user.username}</span>
              </div>
              <Button 
                variant="ghost" 
                className="text-gray-300 hover:text-white font-medium"
                onClick={handleLogout}
              >
                <LogOut size={16} className="mr-2" />
                Logout
              </Button>
            </>
          ) : (
            <Button 
              className="bg-cuemarshal-blue hover:bg-blue-600 text-white font-semibold"
              onClick={handleLogin}
            >
              Login to Platform
            </Button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col md:flex-row overflow-hidden relative">

        {/* Desktop Session Sidebar */}
        <div className="hidden md:flex w-[280px] shrink-0">
          <SessionSidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
            onDeleteSession={handleDeleteSession}
            onToggleFavorite={handleToggleFavorite}
            isOpen={true}
            onClose={() => {}}
            isLoading={sessionsLoading}
          />
        </div>

        {/* Mobile Sidebar Overlay */}
        <SessionSidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          onDeleteSession={handleDeleteSession}
          onToggleFavorite={handleToggleFavorite}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          isLoading={sessionsLoading}
          isMobileOverlay
        />

        {/* Mobile Toggle */}
        <div className="md:hidden flex p-2 bg-gray-50 border-b border-gray-200 gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-2 px-4 rounded-md font-medium text-sm transition-colors flex justify-center items-center gap-2 ${activeTab === 'chat' ? 'bg-white shadow-sm text-cuemarshal-navy border border-gray-200' : 'text-gray-500'}`}
          >
            <Bot size={16} /> Chat
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`flex-1 py-2 px-4 rounded-md font-medium text-sm transition-colors flex justify-center items-center gap-2 ${activeTab === 'activity' ? 'bg-white shadow-sm text-cuemarshal-navy border border-gray-200' : 'text-gray-500'}`}
          >
            <Terminal size={16} /> Activity
          </button>
        </div>

        {/* Left Panel: Chat (Default) */}
        <div className={`flex-1 flex flex-col bg-white border-r border-gray-100 md:flex h-full ${activeTab === 'activity' ? 'hidden md:flex' : 'flex'}`}>
          <ChatView
            currentSessionId={currentSessionId}
            onSessionChange={handleSessionChange}
            onNewChat={handleNewChat}
          />
        </div>

        {/* Right Panel: Activity (Agents) */}
        <div className={`flex-1 flex flex-col bg-cuemarshal-grey md:flex h-full ${activeTab === 'chat' ? 'hidden md:flex' : 'flex'} border-l border-gray-200 relative`}>
          <ActivityView />
        </div>

      </div>
    </div>
  );
}
