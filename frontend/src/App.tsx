import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuth } from "./lib/auth";
import { HomePage } from "./pages/HomePage";
import { ScanDetailPage } from "./pages/ScanDetailPage";
import { MAHomePage } from "./pages/ma/MAHomePage";
import { MADetailPage } from "./pages/ma/MADetailPage";
import { AdminPage } from "./pages/AdminPage";

function RequireMA({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!user.maAccess) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!user.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/scans/:id" element={<ScanDetailPage />} />
        <Route path="/ma" element={<RequireMA><MAHomePage /></RequireMA>} />
        <Route path="/ma/:id" element={<RequireMA><MADetailPage /></RequireMA>} />
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
      </Routes>
    </Layout>
  );
}
