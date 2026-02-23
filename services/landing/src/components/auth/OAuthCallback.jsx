import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../services/auth';
import { useAuthStore } from '../../stores/auth';

export default function OAuthCallback() {
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { login } = useAuthStore();

  useEffect(() => {
    async function handleCallback() {
      const result = await authService.handleOAuthCallback();
      
      if (result.success && result.token && result.user) {
        login(result.token, result.user);
        // Redirect to home page
        navigate('/', { replace: true });
      } else {
        setError(result.error || 'Authentication failed');
      }
    }

    handleCallback();
  }, [login, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cuemarshal-grey">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Authentication Error</h1>
          <p className="text-gray-700 mb-4">{error}</p>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="bg-cuemarshal-blue hover:bg-blue-600 text-white px-4 py-2 rounded"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-cuemarshal-grey">
      <div className="bg-white p-8 rounded-lg shadow-lg">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cuemarshal-blue mb-4"></div>
          <p className="text-gray-700">Completing authentication...</p>
        </div>
      </div>
    </div>
  );
}
