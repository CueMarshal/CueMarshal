import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import WebLanding from './components/landing/WebLanding';
import OAuthCallback from './components/auth/OAuthCallback';
import { useAuthStore } from './stores/auth';

function App() {
  const { initialize, isInitialized } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cuemarshal-grey">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cuemarshal-blue"></div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WebLanding />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
