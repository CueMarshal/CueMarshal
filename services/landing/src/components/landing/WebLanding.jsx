import React, { useState, useEffect } from 'react';
import { Bot, Users, LogOut, User as UserIcon, Sparkles, Menu } from 'lucide-react';
import ChatView from './ChatView';
import ActivityView from './ActivityView';
import SessionSidebar from './SessionSidebar';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '../../stores/auth';
import { fetchChatSessions, deleteChatSession, updateChatSession } from '../../services/api';
import { storage } from '../../services/storage';

export default function WebLanding() {
  const [activeTab, setActiveTab] = useState('chat');
  const { token, user, logout, startOAuthFlow } = useAuthStore();

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

  if (!token || !user) {
    return (
      <div className="min-h-dvh bg-gradient-to-b from-cuemarshal-navy from-30% via-cuemarshal-navy/80 via-50% to-cuemarshal-blue/90 text-white font-inter flex flex-col">
        <header className="flex items-center justify-between p-4 md:p-6 shrink-0">
          <img src="/logo.svg" alt="CueMarshal" className="h-10 w-auto" />
        </header>

        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full text-center">
            <div className="mb-8 flex justify-center">
              <div className="relative">
                <img src="/icon.svg" alt="CueMarshal" className="h-24 w-24 sm:h-32 sm:w-32 animate-pulse" />
                <div className="absolute -inset-4 bg-white/10 rounded-full blur-2xl" />
              </div>
            </div>

            <h1 className="font-montserrat font-bold text-3xl sm:text-4xl md:text-6xl mb-4">
              Welcome to <span className="text-white drop-shadow-[0_0_12px_rgba(0,161,240,0.6)]">CueMarshal</span>
            </h1>
            <p className="text-lg sm:text-xl md:text-2xl text-blue-100 mb-6 sm:mb-8 font-light">
              Your AI-powered development orchestra
            </p>
            <p className="text-base sm:text-lg text-blue-200 mb-10 sm:mb-12 max-w-xl mx-auto">
              Marshal and the team are ready to help you build, review, and deploy with precision and harmony.
            </p>

            <Button
              onClick={handleLogin}
              size="lg"
              className="bg-white text-cuemarshal-navy hover:bg-blue-50 font-bold text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6 rounded-xl shadow-2xl transition-all hover:scale-105 active:scale-100"
            >
              <Sparkles className="mr-2" size={22} />
              Get Started
            </Button>

            <div className="mt-12 sm:mt-16 grid grid-cols-4 md:grid-cols-8 gap-3 sm:gap-4 justify-items-center max-w-sm md:max-w-none mx-auto opacity-60">
              {['ava.png', 'dave.png', 'reese.png', 'tess.png', 'devin.png', 'dot.png', 'linton.png'].map((avatar, i) => (
                <img key={i} src={`/images/avatars/${avatar}`} alt="Team member" className="w-12 h-12 sm:w-16 sm:h-16 rounded-full border-2 border-white/30" />
              ))}
            </div>
          </div>
        </div>

        <footer className="p-4 sm:p-6 text-center text-blue-200 text-xs sm:text-sm shrink-0">
          <p>&copy; 2026 CueMarshal. AI-powered development automation.</p>
        </footer>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-cuemarshal-white text-cuemarshal-charcoal font-inter flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-3 sm:px-4 py-3 bg-cuemarshal-navy text-white shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 -ml-1 text-gray-300 hover:text-white rounded-lg transition-colors"
            aria-label="Open chat history"
          >
            <Menu size={20} />
          </button>
          <img src="/logo.svg" alt="CueMarshal" className="h-7 sm:h-8 w-auto" />
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {token && user ? (
            <>
              <div className="hidden sm:flex items-center gap-2 text-gray-300">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.username} className="w-7 h-7 sm:w-8 sm:h-8 rounded-full" />
                ) : (
                  <UserIcon size={18} />
                )}
                <span className="text-sm font-medium">{user.username}</span>
              </div>
              <Button
                variant="ghost"
                className="text-gray-300 hover:text-white font-medium h-9"
                onClick={handleLogout}
              >
                <LogOut size={16} className="sm:mr-1.5" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </>
          ) : (
            <Button
              className="bg-cuemarshal-blue hover:bg-blue-600 text-white font-semibold"
              onClick={handleLogin}
            >
              Login
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row overflow-hidden">
        {/* Desktop Sidebar */}
        <div className="hidden md:flex w-[240px] xl:w-[280px] shrink-0 border-r border-gray-200">
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

        {/* Tab Bar -- visible below lg breakpoint */}
        <div className="lg:hidden flex p-1.5 sm:p-2 bg-gray-50 border-b border-gray-200 gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-colors flex justify-center items-center gap-2 ${
              activeTab === 'chat'
                ? 'bg-white shadow-sm text-cuemarshal-navy border border-gray-200'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Bot size={16} /> Chat
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-colors flex justify-center items-center gap-2 ${
              activeTab === 'activity'
                ? 'bg-white shadow-sm text-cuemarshal-navy border border-gray-200'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users size={16} /> Team
          </button>
        </div>

        {/* Chat Panel -- primary, takes remaining space */}
        <div className={`flex-1 flex flex-col bg-white min-w-0 ${activeTab === 'activity' ? 'hidden lg:flex' : 'flex'}`}>
          <ChatView
            currentSessionId={currentSessionId}
            onSessionChange={handleSessionChange}
            onNewChat={handleNewChat}
          />
        </div>

        {/* Activity Panel -- fixed width on desktop, full width on mobile/tablet */}
        <div className={`flex-1 lg:flex-none lg:w-[380px] xl:w-[420px] flex flex-col bg-cuemarshal-grey lg:border-l lg:border-gray-200 ${activeTab === 'chat' ? 'hidden lg:flex' : 'flex'}`}>
          <ActivityView />
        </div>
      </div>
    </div>
  );
}
