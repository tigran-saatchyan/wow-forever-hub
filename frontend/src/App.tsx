import { AnimatePresence, motion } from "framer-motion";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useMe } from "./lib/auth";
import { useTheme } from "./theme/ThemeProvider";
import { Characters } from "./pages/Characters";
import { Craft } from "./pages/Craft";
import { Raids } from "./pages/Raids";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Market } from "./pages/Market";
import { Talents } from "./pages/Talents";
import { ThroneRoom } from "./pages/ThroneRoom";

/** The whole hub is private for now: only the superadmin (and later guild members) can open it. */
function Private({ children }: { children: JSX.Element }) {
  const me = useMe();
  if (me.isLoading) return null;
  return me.data ? children : <Navigate to="/login" replace />;
}

/** The Undercity's veil between pages: a band of green and violet mist sweeps across once. */
function Veil({ k }: { k: string }) {
  const { theme } = useTheme();
  if (theme.id !== "undercity") return null;
  return (
    <motion.div
      key={k} className="veil" aria-hidden
      initial={{ x: "-100%", opacity: 0 }} animate={{ x: "100%", opacity: [0, 1, 1, 0] }}
      transition={{ duration: 0.9, ease: "easeInOut" }}
    />
  );
}

export function App() {
  const loc = useLocation();
  return (
    <Layout>
      <Veil k={loc.pathname} />
      <AnimatePresence mode="wait">
        <motion.div
          key={loc.pathname}
          initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
          transition={{ duration: 0.25 }}
        >
          <Routes location={loc}>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Private><ThroneRoom /></Private>} />
            <Route path="/news" element={<Private><Dashboard /></Private>} />
            <Route path="/talents" element={<Private><Talents /></Private>} />
            <Route path="/characters" element={<Private><Characters /></Private>} />
            <Route path="/market" element={<Private><Market /></Private>} />
            <Route path="/craft" element={<Private><Craft /></Private>} />
            <Route path="/raids" element={<Private><Raids /></Private>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </Layout>
  );
}
