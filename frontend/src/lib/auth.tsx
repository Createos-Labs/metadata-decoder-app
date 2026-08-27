import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  signOut as fbSignOut,
  GoogleAuthProvider,
  onIdTokenChanged,
  type User as FBUser,
} from "firebase/auth";
import { api, setAuthToken } from "./api";
import type { AppConfig, AppUser } from "./types";

const firebaseApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        apiKey: "AIzaSyDWI18_-uh9byfX8DeUJFDf6TAxjHzMrRw",
        authDomain: "lab-create-os.firebaseapp.com",
        projectId: "lab-create-os",
      });

const firebaseAuth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();

interface AuthState {
  ready: boolean;
  config: AppConfig | null;
  user: AppUser | null;
  authError: string | null;
  signIn: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const hydrateUser = useCallback(async (fbUser: FBUser) => {
    try {
      const token = await fbUser.getIdToken();
      setAuthToken(token);
      const me = await api.getMe();
      setAuthError(null);
      setUser(me);
    } catch (e) {
      setAuthToken(null);
      setUser(null);
      setAuthError(e instanceof Error ? e.message : "Sign-in failed.");
      await fbSignOut(firebaseAuth);
    }
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const cfg = await api.getConfig();
      setConfig(cfg);

      if (!cfg.authEnabled) {
        try {
          setUser(await api.getMe());
        } catch {
          /* local mode returns a synthetic user */
        }
        setReady(true);
        return;
      }

      unsubscribe = onIdTokenChanged(firebaseAuth, async (fbUser) => {
        if (fbUser) {
          await hydrateUser(fbUser);
        } else {
          setAuthToken(null);
          setUser(null);
        }
        setReady(true);
      });
    })();

    return () => unsubscribe?.();
  }, [hydrateUser]);

  const signIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(firebaseAuth, googleProvider);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Sign-in failed.");
    }
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    setAuthError(null);
    setAuthToken(null);
    fbSignOut(firebaseAuth);
  }, []);

  return (
    <AuthContext.Provider value={{ ready, config, user, authError, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
