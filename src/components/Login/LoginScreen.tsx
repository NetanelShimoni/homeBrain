/**
 * LoginScreen — simple username/password login.
 */
import React, { useState, useCallback } from "react";
import { login } from "../../services/api";

interface LoginScreenProps {
  onLogin: (username: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!username.trim() || !password.trim()) {
        setError("יש למלא שם משתמש וסיסמה");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await login(username.trim(), password.trim());
        if (result.success) {
          onLogin(result.user.username);
        }
      } catch {
        setError("שם משתמש או סיסמה שגויים");
      } finally {
        setIsLoading(false);
      }
    },
    [username, password, onLogin]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSubmit(e as unknown as React.FormEvent);
      }
    },
    [handleSubmit]
  );

  return (
    <div className="login-screen" dir="rtl">
      <div className="login-card">
        <div className="login-header">
          <span className="login-icon">🧠</span>
          <h1>HomeBrain</h1>
          <p>העוזר החכם למכשירי הבית שלך</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="username">שם משתמש</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="הכנס שם משתמש..."
              autoComplete="username"
              autoFocus
              disabled={isLoading}
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">סיסמה</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="הכנס סיסמה..."
              autoComplete="current-password"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="login-error">
              <span>⚠️</span> {error}
            </div>
          )}

          <button
            type="submit"
            className="login-btn"
            disabled={isLoading || !username.trim() || !password.trim()}
          >
            {isLoading ? (
              <>
                <span className="spinner-small" />
                מתחבר...
              </>
            ) : (
              "🔑 התחבר"
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
